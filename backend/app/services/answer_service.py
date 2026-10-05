from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.errors import AppError
from app.models.answer import Answer
from app.models.exam_question import ExamQuestion
from app.services import attempt_service, time_service
from app.utils import clock
from app.utils.clock import to_iso


def validate_answer_value(snapshot: dict, value) -> None:
    t = snapshot["type"]
    ids = {o["id"] for o in (snapshot.get("options") or [])}
    bad = AppError("INVALID_ANSWER", "Invalid answer value.")
    if t == "MCQ_SINGLE":
        if not isinstance(value, str) or value not in ids:
            raise bad
    elif t == "MCQ_MULTIPLE":
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value) \
                or len(set(value)) != len(value) or not set(value) <= ids:
            raise bad
    elif t == "SHORT_TEXT":
        if not isinstance(value, str) or len(value) > 2000:
            raise bad
    else:
        raise bad


def _out(a: Answer) -> dict:
    return {"questionId": a.question_id, "answerValue": a.answer_value, "version": a.version, "savedAt": to_iso(a.last_saved_at)}


def _conflict(a: Answer):
    return AppError("ANSWER_VERSION_CONFLICT", "Answer was changed elsewhere.",
                    details={"version": a.version, "answerValue": a.answer_value})


def save_answer(db: Session, student, attempt_id: str, question_id: str, answer_value, version: int) -> Answer:
    attempt = attempt_service.get_attempt_for_student(db, student, attempt_id)          # 1 owner
    time_service.ensure_not_expired(db, attempt)                                        # 2 expiry
    if attempt.status != "ACTIVE":                                                      # 3 status
        raise AppError("ATTEMPT_ALREADY_SUBMITTED" if attempt.status in attempt_service.TERMINAL else "ATTEMPT_NOT_ACTIVE",
                       "Attempt is not accepting answers.")
    if question_id not in {o["questionId"] for o in attempt.question_order}:           # 4 question
        raise AppError("QUESTION_NOT_IN_ATTEMPT", "Question is not part of this attempt.")
    snap = db.scalar(select(ExamQuestion.snapshot).where(ExamQuestion.exam_id == attempt.exam_id,
                                                         ExamQuestion.question_id == question_id))
    validate_answer_value(snap, answer_value)                                           # 5 value
    row = db.scalar(select(Answer).where(Answer.attempt_id == attempt.id, Answer.question_id == question_id).with_for_update())
    now = clock.utc_now()
    if row is None:                                                                     # 6 version
        if version != 0:
            raise AppError("ANSWER_VERSION_CONFLICT", "Answer was changed elsewhere.", details={"version": 0, "answerValue": None})
        row = Answer(attempt_id=attempt.id, question_id=question_id, answer_value=answer_value, version=1, last_saved_at=now)
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise _conflict(db.scalar(select(Answer).where(Answer.attempt_id == attempt.id, Answer.question_id == question_id)))
        return row
    if row.answer_value == answer_value:   # same value dobara = safe no-op (idempotent)
        db.rollback()
        return row
    if version != row.version:
        db.rollback()
        raise _conflict(row)
    row.answer_value, row.version, row.last_saved_at = answer_value, row.version + 1, now
    db.commit()
    return row


def list_answers(db: Session, student, attempt_id: str) -> list[dict]:
    attempt = attempt_service.get_attempt_for_student(db, student, attempt_id)
    return [_out(a) for a in db.scalars(select(Answer).where(Answer.attempt_id == attempt.id))]
