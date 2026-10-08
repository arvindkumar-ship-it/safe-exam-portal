import platform
import pytest
from datetime import timedelta
from sqlalchemy import text
from app.judge import worker
from app.models.code_submission import CodeSubmission
from app.services import exam_question_service as eqs, publishing_service
from app.utils import clock

pytestmark = pytest.mark.skipif(platform.system() != "Linux", reason="judge needs Linux")
CFG = {"timeLimitMs": 1000, "memoryLimitMb": 64, "languages": ["cpp17", "python3"], "scoring": "ALL_OR_NOTHING"}
GOOD = "print(sum(map(int, input().split())))"


@pytest.fixture(autouse=True)
def _no_throttle(monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "CODE_MIN_INTERVAL_SECONDS", 0.0)


def _setup(client, auth, db, make_user, mk_q, mk_exam, cfg=CFG):
    i, s = make_user("INSTRUCTOR"), make_user("STUDENT")
    q = mk_q(i, "CODING", options=None, correct_answer=None, coding=cfg, marks=10, prompt="Add")
    r = client.post(f"/questions/{q.id}/tests", headers=auth(i), json={"tests": [
        {"input": "1 2\n", "output": "3\n", "isSample": True}, {"input": "5 7\n", "output": "12\n"},
        {"input": "0 0\n", "output": "0\n"}]})
    assert r.status_code == 201
    exam = mk_exam(i)
    eqs.attach_question(db, i, exam.id, q.id)
    publishing_service.publish_exam(db, i, exam.id)
    a = client.post("/attempts/start", json={"examId": exam.id}, headers=auth(s)).json()["data"]["id"]
    return i, s, q, a


def _submit(client, auth, s, a, q, src, mode="SUBMIT"):
    r = client.post(f"/attempts/{a}/code-submissions", headers=auth(s),
                    json={"questionId": q.id, "language": "python3", "source": src, "mode": mode})
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


def _get(client, auth, s, a, sid):
    return client.get(f"/attempts/{a}/code-submissions/{sid}", headers=auth(s)).json()["data"]


def test_ac_and_pending_result_gets_rescored(client, auth, db, make_user, mk_q, mk_exam):
    i, s, q, a = _setup(client, auth, db, make_user, mk_q, mk_exam)
    sid = _submit(client, auth, s, a, q, GOOD)
    assert client.post(f"/attempts/{a}/submit", headers=auth(s)).status_code == 200
    r = client.get(f"/attempts/{a}/result", headers=auth(i)).json()["data"]
    assert r["breakdown"][0]["status"] == "PENDING" and r["totalMarks"] == 0
    assert worker.run_once() is True and worker.run_once() is False
    d = _get(client, auth, s, a, sid)
    assert (d["status"], d["verdict"], d["passed"], d["total"], d["score"]) == ("DONE", "AC", 3, 3, 10.0)
    r = client.get(f"/attempts/{a}/result", headers=auth(i)).json()["data"]   # on_judged ne dobara evaluate kiya
    assert r["breakdown"][0]["status"] == "CORRECT" and r["totalMarks"] == 10 and r["needsManualReview"] is False


def test_partial_score_and_hidden_not_leaked(client, auth, db, make_user, mk_q, mk_exam):
    i, s, q, a = _setup(client, auth, db, make_user, mk_q, mk_exam, {**CFG, "scoring": "PARTIAL"})
    sid = _submit(client, auth, s, a, q, "print(3)")   # sirf sample sahi
    worker.run_once()
    d = _get(client, auth, s, a, sid)
    assert d["verdict"] == "PARTIAL" and d["score"] == 3.33 and d["passed"] == 1 and d["failedTest"] == 2
    hidden = [t for t in d["tests"] if not t["isSample"]]
    assert hidden and all(not ({"input", "expected", "actual"} & set(t)) for t in hidden)


def test_run_mode_and_run_goes_first(client, auth, db, make_user, mk_q, mk_exam):
    i, s, q, a = _setup(client, auth, db, make_user, mk_q, mk_exam)
    sub = _submit(client, auth, s, a, q, GOOD)
    run = _submit(client, auth, s, a, q, GOOD + "\n# r", "RUN")
    worker.run_once()                                  # RUN (priority 0) pehle
    assert _get(client, auth, s, a, run)["status"] == "DONE" and _get(client, auth, s, a, sub)["status"] == "QUEUED"
    assert _get(client, auth, s, a, run)["total"] == 1 and _get(client, auth, s, a, run)["score"] == 0


def test_compile_error_reported(client, auth, db, make_user, mk_q, mk_exam):
    i, s, q, a = _setup(client, auth, db, make_user, mk_q, mk_exam)
    r = client.post(f"/attempts/{a}/code-submissions", headers=auth(s),
                    json={"questionId": q.id, "language": "cpp17", "source": "int main(){", "mode": "SUBMIT"})
    worker.run_once()
    d = _get(client, auth, s, a, r.json()["data"]["id"])
    assert d["verdict"] == "CE" and "error" in d["compileOutput"] and d["score"] == 0


def test_tampered_tests_give_system_error(client, auth, db, make_user, mk_q, mk_exam):
    i, s, q, a = _setup(client, auth, db, make_user, mk_q, mk_exam)
    sid = _submit(client, auth, s, a, q, GOOD)
    db.execute(text("UPDATE coding_tests SET output_text='999' WHERE question_id=:q"), {"q": q.id})
    db.commit()
    worker.run_once()
    d = _get(client, auth, s, a, sid)
    assert d["status"] == "DONE" and d["verdict"] == "SE" and d["score"] == 0


def test_expired_lease_requeued_then_system_error(client, auth, db, make_user, mk_q, mk_exam):
    i, s, q, a = _setup(client, auth, db, make_user, mk_q, mk_exam)
    sid = _submit(client, auth, s, a, q, GOOD)
    assert worker.claim() == sid                       # worker "mar gaya" (JUDGING, kuch nahi kiya)
    db.execute(text("UPDATE code_submissions SET lease_until=:t WHERE id=:i"), {"t": clock.utc_now() - timedelta(seconds=5), "i": sid})
    db.commit()
    assert worker.reap_expired() == 1
    assert _get(client, auth, s, a, sid)["status"] == "QUEUED"
    db.execute(text("UPDATE code_submissions SET status='JUDGING', tries=3, lease_until=:t WHERE id=:i"), {"t": clock.utc_now() - timedelta(seconds=5), "i": sid})
    db.commit()
    worker.reap_expired()
    d = _get(client, auth, s, a, sid)
    assert d["status"] == "DONE" and d["verdict"] == "SE"


def test_real_worker_process_wakes_on_notify(client, auth, db, make_user, mk_q, mk_exam):
    import os, signal, subprocess, sys, time
    i, s, q, a = _setup(client, auth, db, make_user, mk_q, mk_exam)
    root = os.path.join(os.path.dirname(__file__), "..", "..")
    p = subprocess.Popen([sys.executable, "-m", "app.judge.worker"], cwd=root, env=os.environ.copy(),
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(2.5)                                 # worker LISTEN pe aa jaye, queue khaali hai
        t0 = time.time()
        sid = _submit(client, auth, s, a, q, GOOD)
        while time.time() - t0 < 8 and _get(client, auth, s, a, sid)["status"] != "DONE":
            time.sleep(0.1)
        d = _get(client, auth, s, a, sid)
        assert d["status"] == "DONE" and d["verdict"] == "AC"
        assert time.time() - t0 < 3.5                   # 5s polling fallback se pehle => NOTIFY se jaaga
    finally:
        p.send_signal(signal.SIGTERM)
        assert p.wait(timeout=10) == 0                  # graceful stop
