from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, _now, new_id


class ReviewAssignment(Base):
    __tablename__ = "review_assignments"
    __table_args__ = (UniqueConstraint("attempt_id", "reviewer_id", name="uq_review_assignments_attempt_reviewer"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    attempt_id: Mapped[str] = mapped_column(String(36), ForeignKey("exam_attempts.id"), index=True)
    reviewer_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ReviewDecision(Base):
    """Append-only: koi update/delete route ya service function nahi."""
    __tablename__ = "review_decisions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    attempt_id: Mapped[str] = mapped_column(String(36), ForeignKey("exam_attempts.id"), index=True)
    reviewer_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))  # appeal me student ka id
    decision: Mapped[str] = mapped_column(String(30))
    reason: Mapped[str] = mapped_column(Text)
    is_appeal: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
