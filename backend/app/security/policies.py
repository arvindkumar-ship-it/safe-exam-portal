from app.errors import AppError
from app.security.permissions import Role


def ensure(cond: bool) -> None:
    """Foreign object -> NOT_FOUND (enumeration avoid)."""
    if not cond:
        raise AppError("NOT_FOUND", "Not found.")


def can_manage_exam(user, exam) -> bool:
    return user.role == Role.ADMIN.value or (user.role == Role.INSTRUCTOR.value and exam.created_by == user.id)


def _assigned(db, attempt_id: str, user_id: str) -> bool:
    from app.models.review import ReviewAssignment
    return db.query(ReviewAssignment).filter_by(attempt_id=attempt_id, reviewer_id=user_id).first() is not None


def can_review_attempt(user, attempt, db) -> bool:
    if user.role == Role.ADMIN.value:
        return True
    if user.role == Role.INSTRUCTOR.value:
        return can_manage_exam(user, attempt.exam)
    return user.role == Role.REVIEWER.value and _assigned(db, attempt.id, user.id)


def can_view_attempt(user, attempt, db) -> bool:
    return attempt.student_id == user.id or can_review_attempt(user, attempt, db)
