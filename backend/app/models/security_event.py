from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, new_id


class SecurityEvent(Base):
    __tablename__ = "security_events"
    __table_args__ = (
        UniqueConstraint("attempt_id", "source", "sequence_number", name="uq_security_events_attempt_source_seq"),
        UniqueConstraint("attempt_id", "chain_index", name="uq_security_events_attempt_chain"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    attempt_id: Mapped[str] = mapped_column(String(36), ForeignKey("exam_attempts.id"), index=True)
    chain_index: Mapped[int] = mapped_column(Integer)
    event_type: Mapped[str] = mapped_column(String(50))
    severity: Mapped[str] = mapped_column(String(10))
    source: Mapped[str] = mapped_column(String(20))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    sequence_number: Mapped[int] = mapped_column(Integer)
    # attribute 'metadata' SQLAlchemy me reserved hai, isliye event_metadata; column name 'metadata' hi hai
    event_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    previous_hash: Mapped[str] = mapped_column(String(64))
    event_hash: Mapped[str] = mapped_column(String(64))
