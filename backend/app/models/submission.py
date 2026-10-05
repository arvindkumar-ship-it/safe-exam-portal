from datetime import datetime
from decimal import Decimal
from sqlalchemy import DateTime, ForeignKey, JSON, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, _now, new_id


class Submission(Base):
    __tablename__ = "submissions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    attempt_id: Mapped[str] = mapped_column(String(36), ForeignKey("exam_attempts.id"), unique=True)
    reason: Mapped[str] = mapped_column(String(30))
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="SEALED")  # SEALED | EVALUATED
    total_marks: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(100), nullable=True)
    answers_snapshot: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    attempt = relationship("Attempt")
