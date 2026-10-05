from sqlalchemy import select
from app.models.exam_question import ExamQuestion


def _flow(client, auth, make_user, pub_exam, show=True):
    i, s = make_user("INSTRUCTOR"), make_user("STUDENT")
    exam = pub_exam(i, n=2, show_result=show)
    v = client.post("/attempts/start", json={"examId": exam.id}, headers=auth(s)).json()["data"]
    q1, q2 = v["questions"][0]["id"], v["questions"][1]["id"]
    client.put(f"/attempts/{v['id']}/answers/{q1}", json={"answerValue": "o2", "version": 0}, headers=auth(s))
    client.put(f"/attempts/{v['id']}/answers/{q2}", json={"answerValue": "o1", "version": 0}, headers=auth(s))
    client.post(f"/attempts/{v['id']}/submit", headers=auth(s))
    return i, s, exam, v["id"]


def test_hidden_until_published(client, auth, make_user, pub_exam):
    i, s, exam, aid = _flow(client, auth, make_user, pub_exam)
    r = client.get(f"/attempts/{aid}/result", headers=auth(s))
    assert r.status_code == 403 and r.json()["error"]["code"] == "RESULT_NOT_AVAILABLE"
    assert client.post(f"/exams/{exam.id}/results/publish", headers=auth(i)).json()["data"]["published"] == 1
    d = client.get(f"/attempts/{aid}/result", headers=auth(s)).json()["data"]
    assert d["totalMarks"] == 1.0 and d["maxMarks"] == 2.0 and "needsManualReview" not in d
    notes = client.get("/notifications", headers=auth(s)).json()["data"]
    assert notes[0]["kind"] == "RESULT_PUBLISHED"


def test_show_result_false_stays_hidden(client, auth, make_user, pub_exam):
    i, s, exam, aid = _flow(client, auth, make_user, pub_exam, show=False)
    client.post(f"/exams/{exam.id}/results/publish", headers=auth(i))
    assert client.get(f"/attempts/{aid}/result", headers=auth(s)).status_code == 403


def test_student_only_own_and_instructor_sees(client, auth, make_user, pub_exam):
    i, s, exam, aid = _flow(client, auth, make_user, pub_exam)
    other = make_user("STUDENT")
    client.post(f"/exams/{exam.id}/results/publish", headers=auth(i))
    assert client.get(f"/attempts/{aid}/result", headers=auth(other)).status_code == 404
    assert client.get(f"/attempts/{aid}/result", headers=auth(i)).json()["data"]["published"] is True
    stranger = make_user("INSTRUCTOR")
    assert client.get(f"/attempts/{aid}/result", headers=auth(stranger)).status_code == 404
    rows = client.get(f"/exams/{exam.id}/results", headers=auth(i)).json()["data"]
    assert rows["total"] == 1 and rows["items"][0]["studentEmail"] == s.email and rows["items"][0]["totalMarks"] == 1.0
    assert client.get(f"/exams/{exam.id}/results", headers=auth(stranger)).status_code == 404


def test_re_evaluation_changes_score_consistently(client, auth, make_user, pub_exam, db):
    i, s, exam, aid = _flow(client, auth, make_user, pub_exam)
    client.post(f"/exams/{exam.id}/results/publish", headers=auth(i))
    for eq in db.scalars(select(ExamQuestion).where(ExamQuestion.exam_id == exam.id)):
        eq.snapshot = {**eq.snapshot, "correctAnswer": "o1"}  # answer key fix
    db.commit()
    r = client.post(f"/attempts/{aid}/re-evaluate", headers=auth(i)).json()["data"]
    assert r["totalMarks"] == 1.0 and sum(b["awarded"] for b in r["breakdown"]) == 1.0
    assert r["published"] is True
    assert client.post(f"/attempts/{aid}/re-evaluate", headers=auth(s)).status_code == 403
