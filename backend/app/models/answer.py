from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, new_id


class Answer(Base):
    __tablename__ = "answers"
    __table_args__ = (UniqueConstraint("attempt_id", "question_id", name="uq_answers_attempt_question"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    attempt_id: Mapped[str] = mapped_column(String(36), ForeignKey("exam_attempts.id"), index=True)
    question_id: Mapped[str] = mapped_column(String(36), ForeignKey("questions.id"))
    answer_value: Mapped[object] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(Integer, default=1)
    last_saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
