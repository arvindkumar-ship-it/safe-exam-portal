import pytest
from app.errors import AppError
from app.services import question_service as qs

MCQ = {"questionType": "MCQ_SINGLE", "prompt": "q", "marks": 2,
       "options": [{"id": "a", "text": "x"}, {"id": "b", "text": "y"}], "correctAnswer": "a"}


@pytest.mark.parametrize("qtype,opts,ans,good", [
    ("MCQ_SINGLE", [{"id": "a", "text": "x"}, {"id": "b", "text": "y"}], "a", True),
    ("MCQ_SINGLE", [{"id": "a", "text": "x"}, {"id": "b", "text": "y"}], "zz", False),
    ("MCQ_SINGLE", [{"id": "a", "text": "x"}, {"id": "b", "text": "y"}], ["a", "b"], False),
    ("MCQ_SINGLE", [{"id": "a", "text": "x"}], "a", False),
    ("MCQ_SINGLE", [], "a", False),
    ("MCQ_MULTIPLE", [{"id": "a", "text": "x"}, {"id": "b", "text": "y"}], ["a", "b"], True),
    ("MCQ_MULTIPLE", [{"id": "a", "text": "x"}, {"id": "b", "text": "y"}], [], False),
    ("MCQ_MULTIPLE", [{"id": "a", "text": "x"}, {"id": "b", "text": "y"}], ["a", "q"], False),
    ("SHORT_TEXT", None, "four", True),
    ("SHORT_TEXT", None, ["4", "four"], True),
    ("SHORT_TEXT", None, None, True),
    ("SHORT_TEXT", [{"id": "a", "text": "x"}], "x", False),
])
def test_payload_validation(qtype, opts, ans, good):
    if good:
        qs.validate_question_payload(qtype, opts, ans)
    else:
        with pytest.raises(AppError):
            qs.validate_question_payload(qtype, opts, ans)


def test_api_validation_and_instructor_sees_answer(client, make_user, auth):
    h = auth(make_user("INSTRUCTOR"))
    r = client.post("/questions", json=MCQ, headers=h)
    assert r.status_code == 201 and r.json()["data"]["correctAnswer"] == "a"
    assert client.post("/questions", json={**MCQ, "negativeMarks": -1}, headers=h).status_code == 422
    assert client.post("/questions", json={**MCQ, "correctAnswer": "zzz"}, headers=h).status_code == 422
    assert client.post("/questions", json={**MCQ, "options": []}, headers=h).status_code == 422


def test_student_view_has_no_answer(make_user, mk_q):
    q = mk_q(make_user("INSTRUCTOR"))
    v = qs.to_student_view(q)
    assert set(v) == {"id", "type", "prompt", "options", "marks"}
    assert "correctAnswer" not in v and "explanation" not in v


def test_version_increments_and_foreign_404(client, make_user, auth, mk_q):
    a, b = make_user("INSTRUCTOR"), make_user("INSTRUCTOR")
    q = mk_q(a)
    r = client.patch(f"/questions/{q.id}", json={"prompt": "new"}, headers=auth(a))
    assert r.json()["data"]["version"] == 2
    r = client.patch(f"/questions/{q.id}", json={"correctAnswer": "o1"}, headers=auth(a))
    assert r.json()["data"]["version"] == 3
    assert client.get(f"/questions/{q.id}", headers=auth(b)).status_code == 404


def test_delete_in_use_blocked(client, make_user, auth, pub_exam, mk_q):
    i = make_user("INSTRUCTOR")
    exam = pub_exam(i, n=1)
    used = exam and client.get(f"/exams/{exam.id}/questions", headers=auth(i)).json()["data"][0]["questionId"]
    r = client.delete(f"/questions/{used}", headers=auth(i))
    assert r.status_code == 409 and r.json()["error"]["code"] == "QUESTION_IN_USE"
    free = mk_q(i)
    assert client.delete(f"/questions/{free.id}", headers=auth(i)).json()["data"]["isActive"] is False
