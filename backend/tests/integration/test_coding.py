from decimal import Decimal
from sqlalchemy import select
from app.models.code_submission import CodeSubmission
from app.services import exam_question_service as eqs, publishing_service

CFG = {"timeLimitMs": 1000, "memoryLimitMb": 256, "languages": ["cpp17", "python3"], "scoring": "ALL_OR_NOTHING"}
SRC = "print(sum(map(int, input().split())))"


def _coding_exam(client, auth, db, make_user, mk_q, mk_exam, tests=True):
    i, s = make_user("INSTRUCTOR"), make_user("STUDENT")
    q = mk_q(i, "CODING", options=None, correct_answer=None, coding=CFG, marks=10, prompt="Add two numbers")
    if tests:
        r = client.post(f"/questions/{q.id}/tests", headers=auth(i), json={"tests": [
            {"input": "1 2\r\n", "output": "3\n", "isSample": True},
            {"input": "5 7\n", "output": "12\n"}, {"input": "0 0\n", "output": "0\n"}]})
        assert r.status_code == 201, r.text
    exam = mk_exam(i)
    eqs.attach_question(db, i, exam.id, q.id)
    return i, s, q, exam


def test_publish_needs_sample_and_hidden(client, make_user, auth, db, mk_q, mk_exam):
    i, s, q, exam = _coding_exam(client, auth, db, make_user, mk_q, mk_exam, tests=False)
    r = client.post(f"/exams/{exam.id}/publish", json={}, headers=auth(i))
    assert r.status_code == 422 and len(r.json()["error"]["details"]["problems"]) == 2


def test_student_view_hides_hidden_tests_and_submit_flow(client, make_user, auth, db, mk_q, mk_exam):
    i, s, q, exam = _coding_exam(client, auth, db, make_user, mk_q, mk_exam)
    publishing_service.publish_exam(db, i, exam.id)
    snap = eqs.list_exam_questions(db, exam.id)[0].snapshot
    assert snap["testCount"] == 3 and len(snap["testsHash"]) == 64
    v = client.post("/attempts/start", json={"examId": exam.id}, headers=auth(s)).json()["data"]
    qv = v["questions"][0]
    assert qv["type"] == "CODING" and qv["coding"]["samples"] == [{"input": "1 2\n", "output": "3\n"}]
    assert "testsHash" not in str(qv) and "5 7" not in str(qv) and "checker" not in str(qv)
    a = v["id"]
    # draft autosave
    r = client.put(f"/attempts/{a}/answers/{q.id}", headers=auth(s), json={"answerValue": {"language": "python3", "source": SRC}, "version": 0})
    assert r.status_code == 200
    bad = client.put(f"/attempts/{a}/answers/{q.id}", headers=auth(s), json={"answerValue": {"language": "java", "source": "x"}, "version": 1})
    assert bad.status_code == 422
    body = {"questionId": q.id, "language": "python3", "source": SRC, "mode": "SUBMIT"}
    r = client.post(f"/attempts/{a}/code-submissions", headers=auth(s), json=body)
    assert r.status_code == 201 and r.json()["data"]["status"] == "QUEUED" and r.json()["data"]["total"] == 3
    sid = r.json()["data"]["id"]
    assert client.post(f"/attempts/{a}/code-submissions", headers=auth(s), json=body).json()["error"]["code"] == "RATE_LIMITED"
    assert client.get(f"/attempts/{a}/code-submissions/{sid}", headers=auth(s)).json()["data"]["source"] == SRC
    assert client.get(f"/attempts/{a}/code-submissions?questionId={q.id}", headers=auth(s)).json()["data"][0]["id"] == sid
    other = make_user("STUDENT")
    assert client.get(f"/attempts/{a}/code-submissions/{sid}", headers=auth(other)).status_code == 404
    bad_lang = client.post(f"/attempts/{a}/code-submissions", headers=auth(s), json={**body, "language": "c11"})
    assert bad_lang.status_code == 422


def test_tests_locked_after_publish_and_duplicate_rejected(client, make_user, auth, db, mk_q, mk_exam, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "CODE_MIN_INTERVAL_SECONDS", 0.0)
    i, s, q, exam = _coding_exam(client, auth, db, make_user, mk_q, mk_exam)
    publishing_service.publish_exam(db, i, exam.id)
    r = client.post(f"/questions/{q.id}/tests", headers=auth(i), json={"tests": [{"input": "1", "output": "1"}]})
    assert r.status_code == 409 and r.json()["error"]["code"] == "QUESTION_IN_USE"
    a = client.post("/attempts/start", json={"examId": exam.id}, headers=auth(s)).json()["data"]["id"]
    body = {"questionId": q.id, "language": "python3", "source": SRC}
    assert client.post(f"/attempts/{a}/code-submissions", headers=auth(s), json=body).status_code == 201
    d = client.post(f"/attempts/{a}/code-submissions", headers=auth(s), json=body)
    assert d.status_code == 409 and d.json()["error"]["code"] == "DUPLICATE_SUBMISSION"
    run = client.post(f"/attempts/{a}/code-submissions", headers=auth(s), json={**body, "mode": "RUN"})
    assert run.status_code == 201 and run.json()["data"]["total"] == 1


def test_evaluation_pending_then_final(client, make_user, auth, db, mk_q, mk_exam, monkeypatch):
    from app.config import get_settings
    from app.models.submission import Submission
    from app.services import code_submission_service as css
    monkeypatch.setattr(get_settings(), "CODE_MIN_INTERVAL_SECONDS", 0.0)
    i, s, q, exam = _coding_exam(client, auth, db, make_user, mk_q, mk_exam)
    publishing_service.publish_exam(db, i, exam.id)
    a = client.post("/attempts/start", json={"examId": exam.id}, headers=auth(s)).json()["data"]["id"]
    sid = client.post(f"/attempts/{a}/code-submissions", headers=auth(s),
                      json={"questionId": q.id, "language": "python3", "source": SRC}).json()["data"]["id"]
    assert client.post(f"/attempts/{a}/submit", json={}, headers=auth(s)).status_code == 200
    assert client.post(f"/attempts/{a}/code-submissions", headers=auth(s),
                       json={"questionId": q.id, "language": "python3", "source": SRC + "#"}).status_code == 409
    db.expire_all()
    sub = db.scalar(select(Submission).where(Submission.attempt_id == a))
    assert sub.status == "SEALED"  # judge pending
    row = db.get(CodeSubmission, sid)
    row.status, row.verdict, row.score, row.passed = "DONE", "AC", Decimal("10"), 3
    db.commit()
    css.on_judged(db, row)
    db.expire_all()
    sub = db.scalar(select(Submission).where(Submission.attempt_id == a))
    assert sub.status == "EVALUATED" and sub.total_marks == Decimal("10.00")
