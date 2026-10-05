from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from app.errors import AppError
from app.models.exam import Exam
from app.security.permissions import Role
from app.security.policies import can_manage_exam, ensure
from app.utils import clock

EXAM_TRANSITIONS = {"DRAFT": {"PUBLISHED"}, "PUBLISHED": {"ACTIVE"}, "ACTIVE": {"CLOSED"},
                    "CLOSED": {"ARCHIVED"}, "ARCHIVED": set()}
LOCKED_AFTER_DRAFT = {"duration_seconds", "starts_at", "ends_at", "monitoring_policy", "shuffle_questions", "shuffle_options"}
LOCKED_WITH_ATTEMPTS = {"max_attempts", "lock_on_high_risk", "pass_marks"}


def _check_window(starts_at, ends_at):
    if starts_at and ends_at and ends_at <= starts_at:
        raise AppError("VALIDATION_ERROR", "endsAt must be after startsAt.")


def create_exam(db: Session, user, data: dict) -> Exam:
    exam = Exam(**data, created_by=user.id, status="DRAFT")
    db.add(exam)
    db.commit()
    return exam


def get_exam(db: Session, exam_id: str) -> Exam | None:
    return db.get(Exam, exam_id)


def get_exam_for_manage(db: Session, user, exam_id: str) -> Exam:
    exam = get_exam(db, exam_id)
    ensure(exam is not None and can_manage_exam(user, exam))
    return exam


def get_exam_for_user(db: Session, user, exam_id: str) -> Exam:
    exam = get_exam(db, exam_id)
    if user.role == Role.STUDENT.value:
        ensure(exam is not None and exam.status in ("PUBLISHED", "ACTIVE"))
        return exam
    ensure(exam is not None and can_manage_exam(user, exam))
    return exam


def list_exams(db: Session, user, page: int, page_size: int, status: str | None = None):
    q = select(Exam)
    if user.role == Role.STUDENT.value:
        now = clock.utc_now()
        q = q.where(Exam.status.in_(["PUBLISHED", "ACTIVE"]), or_(Exam.ends_at.is_(None), Exam.ends_at > now))
    elif user.role == Role.INSTRUCTOR.value:
        q = q.where(Exam.created_by == user.id)
    if status:
        q = q.where(Exam.status == status)
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    rows = db.scalars(q.order_by(Exam.created_at.desc(), Exam.id).offset((page - 1) * page_size).limit(page_size)).all()
    return list(rows), total


def has_attempts(db: Session, exam_id: str) -> bool:
    from app.models.attempt import Attempt  # A-11 ke baad
    return db.scalar(select(func.count()).select_from(Attempt).where(Attempt.exam_id == exam_id)) > 0


def update_exam(db: Session, user, exam_id: str, data: dict) -> Exam:
    exam = get_exam_for_manage(db, user, exam_id)
    if exam.status != "DRAFT":
        locked = set(LOCKED_AFTER_DRAFT)
        try:
            if has_attempts(db, exam.id):
                locked |= LOCKED_WITH_ATTEMPTS
        except ImportError:
            pass
        for k, v in data.items():
            if k in locked and getattr(exam, k) != v:
                raise AppError("EXAM_NOT_EDITABLE", f"Field '{k}' cannot be changed after the exam is published.")
    for k, v in data.items():
        if v is None and k in ("title", "duration_seconds", "show_result", "max_attempts", "shuffle_questions",
                               "shuffle_options", "lock_on_high_risk", "monitoring_policy"):
            continue  # null in non-null fields = ignore
        setattr(exam, k, v)
    _check_window(exam.starts_at, exam.ends_at)
    db.commit()
    return exam


def delete_draft(db: Session, user, exam_id: str) -> None:
    exam = get_exam_for_manage(db, user, exam_id)
    if exam.status != "DRAFT":
        raise AppError("EXAM_NOT_EDITABLE", "Only draft exams can be deleted.")
    db.delete(exam)
    db.commit()


def transition_exam(db: Session, user, exam_id: str, to: str) -> Exam:
    exam = get_exam_for_manage(db, user, exam_id)
    # PUBLISHED sirf /publish endpoint se (A-09)
    if to == "PUBLISHED" or to not in EXAM_TRANSITIONS.get(exam.status, set()):
        raise AppError("INVALID_STATE_TRANSITION", f"Cannot move exam from {exam.status} to {to}.")
    exam.status = to
    db.commit()
    return exam
