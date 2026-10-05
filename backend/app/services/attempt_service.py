from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.errors import AppError
from app.models.answer import Answer
from app.models.attempt import Attempt
from app.models.exam import Exam
from app.security.policies import ensure
from app.services import attempt_question_service as aqs
from app.services import exam_question_service as eqs
from app.utils import clock
from app.utils.clock import to_iso
from app.utils.randomization import new_seed
from datetime import timedelta

ATTEMPT_TRANSITIONS = {
    "NOT_STARTED": {"ACTIVE"},
    "ACTIVE": {"SUBMITTED", "AUTO_SUBMITTED", "UNDER_REVIEW"},
    "UNDER_REVIEW": {"SUBMITTED", "TERMINATED"},
    "SUBMITTED": set(), "AUTO_SUBMITTED": set(), "TERMINATED": set(),
}
TERMINAL = {"SUBMITTED", "AUTO_SUBMITTED", "TERMINATED"}


def transition_attempt(db: Session, attempt: Attempt, to: str) -> Attempt:
    if to not in ATTEMPT_TRANSITIONS.get(attempt.status, set()):
        raise AppError("INVALID_STATE_TRANSITION", f"Cannot move attempt from {attempt.status} to {to}.")
    attempt.status = to
    return attempt  # commit caller karta hai


def _open_attempt(db, exam_id, student_id) -> Attempt | None:
    return db.scalar(select(Attempt).where(Attempt.exam_id == exam_id, Attempt.student_id == student_id,
                                           Attempt.status.in_(["ACTIVE", "UNDER_REVIEW"])))


def start_attempt(db: Session, student, exam_id: str) -> Attempt:
    from app.services import submission_service
    exam = db.get(Exam, exam_id)
    if exam is None or exam.status == "DRAFT":
        raise AppError("NOT_FOUND", "Exam not found.")
    now = clock.utc_now()
    if exam.status not in ("PUBLISHED", "ACTIVE") or (exam.starts_at and now < exam.starts_at) \
            or (exam.ends_at and now >= exam.ends_at):
        raise AppError("EXAM_NOT_AVAILABLE", "This exam is not available.")
    existing = _open_attempt(db, exam.id, student.id)
    if existing and existing.status == "ACTIVE" and now >= existing.expires_at:
        submission_service.submit_attempt(db, existing, "TIME_EXPIRED")  # purana expired attempt band karo
        existing = None
    if existing:
        return existing  # resume
    used = db.scalar(select(func.count()).select_from(Attempt).where(Attempt.exam_id == exam.id, Attempt.student_id == student.id))
    if used >= exam.max_attempts:
        raise AppError("ATTEMPT_LIMIT_REACHED", "Attempt limit reached.")
    rows = eqs.list_exam_questions(db, exam.id)
    seed = new_seed()
    expires = now + timedelta(seconds=exam.duration_seconds)
    if exam.ends_at:
        expires = min(expires, exam.ends_at)
    attempt = Attempt(exam_id=exam.id, student_id=student.id, status="ACTIVE", started_at=now, expires_at=expires,
                      shuffle_seed=seed, question_order=aqs.build_question_order(rows, seed, exam.shuffle_questions, exam.shuffle_options))
    db.add(attempt)
    if exam.status == "PUBLISHED":
        exam.status = "ACTIVE"
    try:
        db.commit()
    except IntegrityError:  # partial unique index: parallel start
        db.rollback()
        again = _open_attempt(db, exam_id, student.id)
        if again:
            return again
        raise
    attempt.exam = exam
    return attempt


def get_attempt_for_student(db: Session, student, attempt_id: str) -> Attempt:
    attempt = db.get(Attempt, attempt_id)
    ensure(attempt is not None and attempt.student_id == student.id)
    return attempt


def list_mine(db: Session, student, exam_id: str | None = None) -> list[Attempt]:
    q = select(Attempt).where(Attempt.student_id == student.id)
    if exam_id:
        q = q.where(Attempt.exam_id == exam_id)
    return list(db.scalars(q.order_by(Attempt.started_at.desc())))


def attempt_view(db: Session, attempt: Attempt) -> dict:
    exam = attempt.exam
    snaps = {r.question_id: r.snapshot for r in eqs.list_exam_questions(db, exam.id)}
    answers = {a.question_id: a for a in db.scalars(select(Answer).where(Answer.attempt_id == attempt.id))}
    return {"id": attempt.id,
            "exam": {"id": exam.id, "title": exam.title, "durationSeconds": exam.duration_seconds},
            "status": attempt.status, "startedAt": to_iso(attempt.started_at), "expiresAt": to_iso(attempt.expires_at),
            "submittedAt": to_iso(attempt.submitted_at), "serverTime": to_iso(clock.utc_now()),
            "monitoringPolicy": exam.monitoring_policy or {},
            "questions": aqs.render_questions_for_student(attempt.question_order, snaps, answers)}
