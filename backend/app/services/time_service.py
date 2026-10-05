from datetime import timedelta
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.config import get_settings
from app.errors import AppError
from app.models.attempt import Attempt
from app.utils import clock


def remaining_seconds(attempt, now=None) -> int:
    now = now or clock.utc_now()
    return max(0, int((attempt.expires_at - now).total_seconds()))


def is_expired(attempt, now=None) -> bool:
    return (now or clock.utc_now()) >= attempt.expires_at


def within_submit_grace(attempt, now) -> bool:
    return now < attempt.expires_at + timedelta(seconds=get_settings().SUBMIT_GRACE_SECONDS)


def expire_if_needed(db: Session, attempt) -> bool:
    """ACTIVE + expired => auto-submit. True agar abhi submit hua."""
    from app.services import submission_service
    if attempt.status == "ACTIVE" and is_expired(attempt):
        submission_service.submit_attempt(db, attempt, "TIME_EXPIRED")
        return True
    return False


def ensure_not_expired(db: Session, attempt) -> None:
    if expire_if_needed(db, attempt):
        raise AppError("ATTEMPT_EXPIRED", "Time is up. Your exam was submitted.")


def auto_submit_expired(db: Session) -> int:
    from app.services import submission_service
    now = clock.utc_now()
    rows = db.scalars(select(Attempt).where(Attempt.status == "ACTIVE", Attempt.expires_at <= now)).all()
    n = 0
    for a in rows:
        submission_service.submit_attempt(db, a, "TIME_EXPIRED")
        n += 1
    return n
