from datetime import timedelta
from sqlalchemy import func, select
from app.models.attempt import Attempt
from app.models.submission import Submission


def submit(client, auth, s, aid, key=None):
    h = auth(s)
    if key:
        h["Idempotency-Key"] = key
    return client.post(f"/attempts/{aid}/submit", headers=h)


def test_manual_submit_receipt(started, client, auth):
    i, s, exam, v = started(n=3)
    qid = v["questions"][0]["id"]
    client.put(f"/attempts/{v['id']}/answers/{qid}", json={"answerValue": "o1", "version": 0}, headers=auth(s))
    d = submit(client, auth, s, v["id"]).json()["data"]
    assert d["reason"] == "MANUAL" and d["answeredCount"] == 1 and d["totalQuestions"] == 3
    assert set(d) >= {"submissionId", "attemptId", "status", "reason", "submittedAt", "answeredCount", "totalQuestions"}
    assert d["attemptStatus"] == "SUBMITTED"


def test_same_request_twice_one_row(started, client, auth, db):
    i, s, exam, v = started()
    a = submit(client, auth, s, v["id"], "key-1").json()["data"]
    b = submit(client, auth, s, v["id"], "key-1").json()["data"]
    assert a == b
    assert db.scalar(select(func.count()).select_from(Submission)) == 1


def test_timer_submit_reason(started, client, auth, freeze, db):
    i, s, exam, v = started(duration_seconds=120)
    a = db.get(Attempt, v["id"])
    freeze(a.expires_at + timedelta(seconds=1))
    client.post(f"/attempts/{a.id}/heartbeat", headers=auth(s))
    d = submit(client, auth, s, a.id).json()["data"]  # already auto-submitted -> same receipt
    assert d["reason"] == "TIME_EXPIRED" and d["attemptStatus"] == "AUTO_SUBMITTED"


def test_late_manual_submit_is_time_expired_and_grace_ok(started, client, auth, freeze, db, make_user, pub_exam):
    i, s, exam, v = started(duration_seconds=120)
    a = db.get(Attempt, v["id"])
    freeze(a.expires_at + timedelta(seconds=3))  # grace ke andar
    assert submit(client, auth, s, a.id).json()["data"]["reason"] == "MANUAL"
    s2 = make_user("STUDENT")
    v2 = client.post("/attempts/start", json={"examId": exam.id}, headers=auth(s2)).json()["data"]
    a2 = db.get(Attempt, v2["id"])
    freeze(a2.expires_at + timedelta(seconds=6))  # grace ke baad
    d = submit(client, auth, s2, a2.id).json()["data"]
    assert d["reason"] == "TIME_EXPIRED" and d["attemptStatus"] == "AUTO_SUBMITTED"


def test_answers_immutable_after_submit(started, client, auth, db):
    i, s, exam, v = started()
    qid = v["questions"][0]["id"]
    client.put(f"/attempts/{v['id']}/answers/{qid}", json={"answerValue": "o1", "version": 0}, headers=auth(s))
    submit(client, auth, s, v["id"])
    r = client.put(f"/attempts/{v['id']}/answers/{qid}", json={"answerValue": "o2", "version": 1}, headers=auth(s))
    assert r.status_code == 409
    sub = db.scalar(select(Submission))
    assert sub.answers_snapshot == [{"questionId": qid, "answerValue": "o1", "version": 1}] and sub.status in ("SEALED", "EVALUATED")


def test_other_student_cannot_submit(started, client, auth, make_user):
    i, s, exam, v = started()
    assert submit(client, auth, make_user("STUDENT"), v["id"]).status_code == 404
