from app.services import exam_question_service as eqs


def test_invalid_draft_blocked_with_problems(client, make_user, auth, mk_exam):
    i = make_user("INSTRUCTOR")
    exam = mk_exam(i)
    r = client.post(f"/exams/{exam.id}/publish", json={}, headers=auth(i))
    assert r.status_code == 422 and r.json()["error"]["code"] == "EXAM_NOT_PUBLISHABLE"
    assert any("question" in p.lower() for p in r.json()["error"]["details"]["problems"])


def test_past_window_problem(client, make_user, auth, mk_exam, mk_q, db):
    from tests.conftest import utc
    i = make_user("INSTRUCTOR")
    exam = mk_exam(i, ends_at=utc(hours=-1))
    eqs.attach_question(db, i, exam.id, mk_q(i).id)
    r = client.post(f"/exams/{exam.id}/publish", json={}, headers=auth(i))
    assert any("future" in p for p in r.json()["error"]["details"]["problems"])


def test_publish_fills_snapshots_and_freezes(client, make_user, auth, pub_exam, db):
    i = make_user("INSTRUCTOR")
    exam = pub_exam(i, n=2)
    assert exam.status == "PUBLISHED"
    rows = eqs.list_exam_questions(db, exam.id)
    assert all(r.snapshot and r.snapshot["correctAnswer"] == "o2" for r in rows)
    qid = rows[0].question_id
    client.patch(f"/questions/{qid}", json={"correctAnswer": "o1", "prompt": "changed"}, headers=auth(i))
    db.expire_all()
    assert eqs.list_exam_questions(db, exam.id)[0].snapshot["correctAnswer"] == "o2"  # snapshot nahi badla
    assert eqs.list_exam_questions(db, exam.id)[0].snapshot["prompt"] == "2+2?"


def test_marks_override_in_snapshot(make_user, mk_exam, mk_q, db):
    from app.services import publishing_service
    i = make_user("INSTRUCTOR")
    exam = mk_exam(i)
    eqs.attach_question(db, i, exam.id, mk_q(i).id, marks=5)
    publishing_service.publish_exam(db, i, exam.id)
    assert eqs.list_exam_questions(db, exam.id)[0].snapshot["marks"] == 5.0


def test_cannot_publish_twice(client, make_user, auth, pub_exam):
    i = make_user("INSTRUCTOR")
    exam = pub_exam(i)
    assert client.post(f"/exams/{exam.id}/publish", json={}, headers=auth(i)).status_code == 409
