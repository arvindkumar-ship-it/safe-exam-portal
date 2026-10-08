import logging
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.models.answer import Answer
from app.models.attempt import Attempt
from app.models.submission import Submission
from app.services import attempt_service, time_service
from app.utils import clock
from app.utils.clock import to_iso

log = logging.getLogger("safeexam.submission")
TARGET = {"TIME_EXPIRED": "AUTO_SUBMITTED", "POLICY_VIOLATION": "AUTO_SUBMITTED",
          "POLICY_TERMINATION": "TERMINATED"}  # baaki -> SUBMITTED


def _existing(db, attempt_id):
    return db.scalar(select(Submission).where(Submission.attempt_id == attempt_id))


def submit_attempt(db: Session, attempt: Attempt, reason: str, idempotency_key: str | None = None) -> Submission:
    """Idempotent: pehle se submitted ho toh wahi submission (no new row, no error)."""
    db.execute(select(Attempt.id).where(Attempt.id == attempt.id).with_for_update())  # row lock
    db.refresh(attempt)
    sub = _existing(db, attempt.id)
    if sub:
        db.rollback()
        return sub
    now = clock.utc_now()
    if reason == "MANUAL" and not time_service.within_submit_grace(attempt, now):
        reason = "TIME_EXPIRED"  # bahut late manual submit
    answers = db.scalars(select(Answer).where(Answer.attempt_id == attempt.id).order_by(Answer.question_id)).all()
    snapshot = [{"questionId": a.question_id, "answerValue": a.answer_value, "version": a.version} for a in answers]
    attempt_service.transition_attempt(db, attempt, TARGET.get(reason, "SUBMITTED"))
    attempt.submitted_at = now
    sub = Submission(attempt_id=attempt.id, reason=reason, submitted_at=now, status="SEALED",
                     idempotency_key=idempotency_key, answers_snapshot=snapshot)
    db.add(sub)
    try:
        db.commit()
    except IntegrityError:  # parallel submit
        db.rollback()
        return _existing(db, attempt.id)
    try:  # A-15: evaluation; fail ho toh bhi submission safe
        from app.services import evaluation_service
        evaluation_service.evaluate_attempt(db, attempt.id)
        db.refresh(sub)
    except Exception:
        db.rollback()
        log.exception("evaluation failed attempt=%s", attempt.id)
    return sub


def get_receipt(sub: Submission) -> dict:
    a = sub.attempt
    return {"submissionId": sub.id, "attemptId": sub.attempt_id, "status": sub.status, "reason": sub.reason,
            "submittedAt": to_iso(sub.submitted_at),
            "answeredCount": sum(1 for x in sub.answers_snapshot if x["answerValue"] not in (None, "", [])),
            "totalQuestions": len(a.question_order), "attemptStatus": a.status}
