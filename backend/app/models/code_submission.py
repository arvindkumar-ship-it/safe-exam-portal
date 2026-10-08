from datetime import datetime
from decimal import Decimal
from sqlalchemy import DateTime, ForeignKey, Index, Integer, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, _now, new_id


class CodeSubmission(Base):
    """Ek code submission = ek judge job. status: QUEUED -> JUDGING -> DONE.
    verdict: AC WA TLE MLE RE CE OLE SE PARTIAL. mode: RUN (sirf samples, score nahi) | SUBMIT."""
    __tablename__ = "code_submissions"
    __table_args__ = (
        Index("ix_code_submissions_queue", "status", "priority", "queued_at"),
        Index("ix_code_submissions_attempt_question", "attempt_id", "question_id", "created_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    attempt_id: Mapped[str] = mapped_column(String(36), ForeignKey("exam_attempts.id"))
    question_id: Mapped[str] = mapped_column(String(36), ForeignKey("questions.id"))
    student_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    language: Mapped[str] = mapped_column(String(16))
    mode: Mapped[str] = mapped_column(String(8))
    source: Mapped[str] = mapped_column(Text)
    source_sha256: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(10), default="QUEUED")
    verdict: Mapped[str | None] = mapped_column(String(8), nullable=True)
    passed: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    score: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=Decimal("0"))
    max_score: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=Decimal("0"))
    time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    memory_kb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    failed_test: Mapped[int | None] = mapped_column(Integer, nullable=True)
    compile_output: Mapped[str | None] = mapped_column(Text, nullable=True)
    test_results: Mapped[list] = mapped_column(JSON, default=list)
    priority: Mapped[int] = mapped_column(Integer, default=1)
    tries: Mapped[int] = mapped_column(Integer, default=0)
    judge_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    queued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
