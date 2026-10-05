from datetime import datetime
from decimal import Decimal
from sqlalchemy import Boolean, DateTime, ForeignKey, JSON, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, _now, new_id


class Result(Base):
    __tablename__ = "results"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    attempt_id: Mapped[str] = mapped_column(String(36), ForeignKey("exam_attempts.id"), unique=True)
    total_marks: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    max_marks: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    passed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    breakdown: Mapped[list] = mapped_column(JSON, default=list)
    needs_manual_review: Mapped[bool] = mapped_column(Boolean, default=False)
    published: Mapped[bool] = mapped_column(Boolean, default=False)
    evaluated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
