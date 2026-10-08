from decimal import Decimal
from sqlalchemy import Boolean, ForeignKey, Integer, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, TimestampMixin, new_id


class Question(Base, TimestampMixin):
    __tablename__ = "questions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    question_type: Mapped[str] = mapped_column(String(20))
    prompt: Mapped[str] = mapped_column(Text)
    options: Mapped[list | None] = mapped_column(JSON, nullable=True)
    correct_answer: Mapped[object | None] = mapped_column(JSON, nullable=True)
    coding: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # sirf CODING: limits, languages, checker, scoring
    marks: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    negative_marks: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
