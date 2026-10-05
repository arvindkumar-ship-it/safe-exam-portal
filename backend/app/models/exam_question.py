from decimal import Decimal
from sqlalchemy import Boolean, ForeignKey, Integer, JSON, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, new_id


class ExamQuestion(Base):
    __tablename__ = "exam_questions"
    __table_args__ = (UniqueConstraint("exam_id", "question_id", name="uq_exam_questions_exam_question"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    exam_id: Mapped[str] = mapped_column(String(36), ForeignKey("exams.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[str] = mapped_column(String(36), ForeignKey("questions.id"))
    position: Mapped[int] = mapped_column(Integer)
    marks: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)  # per-exam override
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # publish pe fill
    question = relationship("Question", lazy="joined")
