import pytest
from datetime import timedelta
from app.errors import AppError
from app.models.attempt import Attempt
from app.models.exam import Exam
from app.services import attempt_service
from app.utils import clock


def start(client, auth, s, exam_id):
    return client.post("/attempts/start", json={"examId": exam_id}, headers=auth(s))



def test_start_and_view(client, make_user, auth, pub_exam, db):
    i, s = make_user("INSTRUCTOR"), make_user("STUDENT")
    exam = pub_exam(i, n=3)
    r = start(client, auth, s, exam.id)
    v = r.json()["data"]
    assert v["status"] == "ACTIVE" and len(v["questions"]) == 3 and v["serverTime"].endswith("Z")
    for k in ("correctAnswer", "explanation", "shuffleSeed", "shuffle_seed", "riskScore"):
        assert k not in r.text
    assert [q["position"] for q in v["questions"]] == [1, 2, 3]
    db.expire_all()
    assert db.get(Exam, exam.id).status == "ACTIVE"  # PUBLISHED -> ACTIVE


def test_duplicate_start_returns_same(client, make_user, auth, pub_exam):
    i, s = make_user("INSTRUCTOR"), make_user("STUDENT")
    exam = pub_exam(i)
    a = start(client, auth, s, exam.id).json()["data"]
    b = start(client, auth, s, exam.id).json()["data"]
    assert a["id"] == b["id"] and [q["id"] for q in a["questions"]] == [q["id"] for q in b["questions"]]


def test_closed_archived_draft_and_window(client, make_user, auth, pub_exam, mk_exam, db):
    i, s = make_user("INSTRUCTOR"), make_user("STUDENT")
    e = pub_exam(i)
    for st in ("CLOSED", "ARCHIVED"):
        db.get(Exam, e.id).status = st
        db.commit()
        r = start(client, auth, s, e.id)
        assert r.status_code == 409 and r.json()["error"]["code"] == "EXAM_NOT_AVAILABLE"
    assert start(client, auth, s, mk_exam(i).id).status_code == 404
    future = pub_exam(i, starts_at=clock.utc_now() + timedelta(hours=1))
    assert start(client, auth, s, future.id).json()["error"]["code"] == "EXAM_NOT_AVAILABLE"


def test_limit_reached(client, make_user, auth, pub_exam):
    i, s = make_user("INSTRUCTOR"), make_user("STUDENT")
    exam = pub_exam(i)
    aid = start(client, auth, s, exam.id).json()["data"]["id"]
    client.post(f"/attempts/{aid}/submit", headers=auth(s))
    r = start(client, auth, s, exam.id)
    assert r.status_code == 409 and r.json()["error"]["code"] == "ATTEMPT_LIMIT_REACHED"


def test_second_attempt_allowed_when_max_2(client, make_user, auth, pub_exam):
    i, s = make_user("INSTRUCTOR"), make_user("STUDENT")
    exam = pub_exam(i, max_attempts=2)
    a1 = start(client, auth, s, exam.id).json()["data"]["id"]
    client.post(f"/attempts/{a1}/submit", headers=auth(s))
    a2 = start(client, auth, s, exam.id).json()["data"]["id"]
    assert a1 != a2 and len(client.get(f"/attempts/mine?examId={exam.id}", headers=auth(s)).json()["data"]) == 2


def test_expires_at_server_set(client, make_user, auth, pub_exam):
    i, s = make_user("INSTRUCTOR"), make_user("STUDENT")
    exam = pub_exam(i, duration_seconds=600)
    r = client.post("/attempts/start", json={"examId": exam.id, "expiresAt": "2099-01-01T00:00:00Z"}, headers=auth(s))
    v = r.json()["data"]
    assert v["expiresAt"] < "2030" and v["exam"]["durationSeconds"] == 600


def test_expires_capped_by_exam_end(client, make_user, auth, pub_exam):
    i, s = make_user("INSTRUCTOR"), make_user("STUDENT")
    exam = pub_exam(i, duration_seconds=3600, ends_at=clock.utc_now() + timedelta(minutes=10))
    v = start(client, auth, s, exam.id).json()["data"]
    assert v["expiresAt"] == clock.to_iso(exam.ends_at)


def test_other_student_404_and_resume_keeps_answers(client, make_user, auth, pub_exam):
    i, s, other = make_user("INSTRUCTOR"), make_user("STUDENT"), make_user("STUDENT")
    exam = pub_exam(i)
    v = start(client, auth, s, exam.id).json()["data"]
    assert client.get(f"/attempts/{v['id']}", headers=auth(other)).status_code == 404
    qid = v["questions"][0]["id"]
    client.put(f"/attempts/{v['id']}/answers/{qid}", json={"answerValue": "o1", "version": 0}, headers=auth(s))
    again = client.get(f"/attempts/{v['id']}", headers=auth(s)).json()["data"]
    assert [q["id"] for q in again["questions"]] == [q["id"] for q in v["questions"]]
    assert next(q for q in again["questions"] if q["id"] == qid)["answer"] == {"answerValue": "o1", "version": 1}


def test_terminal_cannot_reopen(client, make_user, auth, pub_exam, db):
    i, s = make_user("INSTRUCTOR"), make_user("STUDENT")
    aid = start(client, auth, s, pub_exam(i).id).json()["data"]["id"]
    client.post(f"/attempts/{aid}/submit", headers=auth(s))
    db.expire_all()
    a = db.get(Attempt, aid)
    assert a.status == "SUBMITTED"
    for to in ("ACTIVE", "UNDER_REVIEW", "TERMINATED"):
        with pytest.raises(AppError) as e:
            attempt_service.transition_attempt(db, a, to)
        assert e.value.code == "INVALID_STATE_TRANSITION"


def test_instructor_cannot_start(client, make_user, auth, pub_exam):
    i = make_user("INSTRUCTOR")
    assert start(client, auth, i, pub_exam(i).id).status_code == 403
