from sqlalchemy import select
from sqlalchemy.orm import Session
from app.errors import AppError
from app.models.notification import Notification

KINDS = {"RESULT_PUBLISHED", "ATTEMPT_UNDER_REVIEW", "REVIEW_DECISION", "APPEAL_FILED", "REVIEW_ASSIGNED"}


def notify(db: Session, user_id: str, kind: str, title: str, body: str) -> Notification:
    """In-app only. Commit caller karta hai."""
    if kind not in KINDS:
        raise AppError("VALIDATION_ERROR", "Unknown notification kind.")
    n = Notification(user_id=user_id, kind=kind, title=title, body=body)
    db.add(n)
    db.flush()
    return n


def list_for_user(db: Session, user) -> list[Notification]:
    return list(db.scalars(select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc()).limit(100)))


def mark_read(db: Session, user, notification_id: str) -> Notification:
    n = db.get(Notification, notification_id)
    if n is None or n.user_id != user.id:
        raise AppError("NOT_FOUND", "Notification not found.")
    n.is_read = True
    db.commit()
    return n
