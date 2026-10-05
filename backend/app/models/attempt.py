from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, JSON, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin, new_id


class Attempt(Base, TimestampMixin):
    __tablename__ = "exam_attempts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    exam_id: Mapped[str] = mapped_column(String(36), ForeignKey("exams.id"), index=True)
    student_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    question_order: Mapped[list] = mapped_column(JSON, default=list)
    shuffle_seed: Mapped[int] = mapped_column(Integer)  # kabhi expose nahi
    risk_score: Mapped[int] = mapped_column(Integer, default=0)
    needs_review: Mapped[bool] = mapped_column(Boolean, default=False)
    exam = relationship("Exam")
    student = relationship("User")
    __table_args__ = (
        # ek student ka ek exam me ek hi ACTIVE/UNDER_REVIEW attempt
        Index("uq_active_attempt", "exam_id", "student_id", unique=True,
              postgresql_where=text("status IN ('ACTIVE','UNDER_REVIEW')")),
    )
