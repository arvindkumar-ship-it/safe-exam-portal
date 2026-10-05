from decimal import Decimal
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.errors import AppError
from app.models.attempt import Attempt
from app.models.result import Result
from app.models.submission import Submission
from app.services import exam_question_service as eqs
from app.services.scoring_rules import SCORERS, _d
from app.utils import clock


def evaluate_attempt(db: Session, attempt_id: str) -> Result:
    """Sirf submitted attempts. Answers submission.answers_snapshot se (immutable), key snapshot se."""
    attempt = db.get(Attempt, attempt_id)
    sub = db.scalar(select(Submission).where(Submission.attempt_id == attempt_id))
    if attempt is None or sub is None:
        raise AppError("INVALID_STATE_TRANSITION", "Only submitted attempts can be evaluated.")
    answers = {a["questionId"]: a["answerValue"] for a in sub.answers_snapshot}
    total, max_marks, manual, breakdown = Decimal("0"), Decimal("0"), False, []
    for r in eqs.list_exam_questions(db, attempt.exam_id):
        snap = r.snapshot
        awarded, status = SCORERS[snap["type"]](snap, answers.get(r.question_id))
        total += awarded
        max_marks += _d(snap["marks"])
        manual = manual or status == "MANUAL"
        breakdown.append({"questionId": r.question_id, "status": status, "awarded": float(awarded), "max": float(_d(snap["marks"]))})
    total, max_marks = _d(total), _d(max_marks)
    pass_marks = attempt.exam.pass_marks
    passed = None if pass_marks is None else total >= pass_marks
    res = db.scalar(select(Result).where(Result.attempt_id == attempt_id))
    if res is None:
        res = Result(attempt_id=attempt_id)
        db.add(res)
    res.total_marks, res.max_marks, res.passed = total, max_marks, passed
    res.breakdown, res.needs_manual_review, res.evaluated_at = breakdown, manual, clock.utc_now()
    sub.status, sub.total_marks = "EVALUATED", total
    db.commit()
    return res
