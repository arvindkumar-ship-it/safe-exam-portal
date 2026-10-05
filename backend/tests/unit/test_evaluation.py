from decimal import Decimal
import pytest
from sqlalchemy import select
from app.errors import AppError
from app.models.exam_question import ExamQuestion
from app.models.result import Result
from app.models.submission import Submission
from app.services import evaluation_service as ev
from app.services.scoring_rules import score_mcq_multiple, score_mcq_single, score_short_text

S = {"marks": 2, "negativeMarks": 0.5, "correctAnswer": "a"}
M = {"marks": 3, "negativeMarks": 1, "correctAnswer": ["a", "c"]}
T = {"marks": 1, "negativeMarks": 0, "correctAnswer": [" Four ", "4"]}


def test_single():
    assert score_mcq_single(S, "a") == (Decimal("2.00"), "CORRECT")
    assert score_mcq_single(S, "b") == (Decimal("-0.50"), "WRONG")
    assert score_mcq_single(S, None) == (Decimal("0.00"), "EMPTY")


def test_multiple_exact_only():
    assert score_mcq_multiple(M, ["c", "a"])[1] == "CORRECT"
    assert score_mcq_multiple(M, ["a"]) == (Decimal("-1.00"), "WRONG")  # partial nahi
    assert score_mcq_multiple(M, ["a", "b", "c"])[1] == "WRONG"
    assert score_mcq_multiple(M, [])[1] == "EMPTY"


def test_short_text_variants_and_manual():
    for ans in ("four", "  FOUR ", "4"):
        assert score_short_text(T, ans)[1] == "CORRECT"
    assert score_short_text(T, "five")[1] == "WRONG"
    assert score_short_text(T, "  ")[1] == "EMPTY"
    assert score_short_text({**T, "correctAnswer": None}, "anything") == (Decimal("0.00"), "MANUAL")
    assert score_short_text({**T, "correctAnswer": "x"}, "X")[1] == "CORRECT"


def test_rounding():
    assert score_mcq_single({"marks": 1.005, "correctAnswer": "a"}, "a")[0] == Decimal("1.01")


def _submitted(client, auth, make_user, pub_exam, types, answers, **kw):
    i, s = make_user("INSTRUCTOR"), make_user("STUDENT")
    exam = pub_exam(i, n=len(types), types=types, **kw)
    v = client.post("/attempts/start", json={"examId": exam.id}, headers=auth(s)).json()["data"]
    by_type = {q["type"]: q["id"] for q in v["questions"]}
    for t, val in answers.items():
        r = client.put(f"/attempts/{v['id']}/answers/{by_type[t]}", json={"answerValue": val, "version": 0}, headers=auth(s))
        assert r.status_code == 200, r.text
    client.post(f"/attempts/{v['id']}/submit", headers=auth(s))
    return i, s, exam, v


def test_evaluate_total_is_sum_and_manual_flag(client, auth, make_user, pub_exam, db):
    # MCQ_SINGLE correct (o2), MCQ_MULTIPLE correct, SHORT_TEXT empty
    i, s, exam, v = _submitted(client, auth, make_user, pub_exam, ["MCQ_SINGLE", "MCQ_MULTIPLE", "SHORT_TEXT"],
                               {"MCQ_SINGLE": "o2", "MCQ_MULTIPLE": ["o1", "o3"]}, pass_marks=2)
    r = db.scalar(select(Result).where(Result.attempt_id == v["id"]))
    assert float(r.total_marks) == sum(b["awarded"] for b in r.breakdown) == 2.0
    assert float(r.max_marks) == 3.0 and r.passed is True and r.needs_manual_review is False
    assert {b["status"] for b in r.breakdown} == {"CORRECT", "EMPTY"}
    assert db.scalar(select(Submission).where(Submission.attempt_id == v["id"])).status == "EVALUATED"


def test_manual_review_marker(client, auth, make_user, pub_exam, db, mk_exam, mk_q):
    from app.services import exam_question_service as eqs, publishing_service
    i, s = make_user("INSTRUCTOR"), make_user("STUDENT")
    exam = mk_exam(i)
    q = mk_q(i, "SHORT_TEXT", correct_answer=None)
    eqs.attach_question(db, i, exam.id, q.id)
    publishing_service.publish_exam(db, i, exam.id)
    v = client.post("/attempts/start", json={"examId": exam.id}, headers=auth(s)).json()["data"]
    client.put(f"/attempts/{v['id']}/answers/{q.id}", json={"answerValue": "essay", "version": 0}, headers=auth(s))
    client.post(f"/attempts/{v['id']}/submit", headers=auth(s))
    r = db.scalar(select(Result).where(Result.attempt_id == v["id"]))
    assert r.needs_manual_review is True and r.breakdown[0]["status"] == "MANUAL" and float(r.total_marks) == 0


def test_evaluating_non_submitted_blocked(client, auth, make_user, pub_exam, db):
    i, s = make_user("INSTRUCTOR"), make_user("STUDENT")
    v = client.post("/attempts/start", json={"examId": pub_exam(i).id}, headers=auth(s)).json()["data"]
    with pytest.raises(AppError):
        ev.evaluate_attempt(db, v["id"])
