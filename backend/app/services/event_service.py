from datetime import timedelta
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.config import get_settings
from app.errors import AppError
from app.events.event_types import CLIENT_SOURCES
from app.events.event_validator import validate_event
from app.events.risk_rules import severity_for, weight_for
from app.models.security_event import SecurityEvent
from app.services import attempt_service, audit_service, risk_service
from app.utils import clock

LATE_EVENT_WINDOW = timedelta(minutes=5)


def _acknowledged(db, attempt_id, source) -> int:
    seqs = sorted(db.scalars(select(SecurityEvent.sequence_number).where(
        SecurityEvent.attempt_id == attempt_id, SecurityEvent.source == source)))
    up_to = 0
    for s in seqs:
        if s != up_to + 1:
            break
        up_to = s
    return up_to


def ingest_batch(db: Session, student, attempt_id: str, events: list) -> dict:
    s = get_settings()
    attempt = attempt_service.get_attempt_for_student(db, student, attempt_id)
    if not events or len(events) > s.EVENT_BATCH_MAX:
        raise AppError("VALIDATION_ERROR", f"Batch must contain 1..{s.EVENT_BATCH_MAX} events.")
    sources = {e.get("source") if isinstance(e, dict) else None for e in events}
    if len(sources) != 1 or next(iter(sources)) not in CLIENT_SOURCES:
        raise AppError("EVENT_MIXED_SOURCE", "All events must share one client source (WEB_CLIENT or NATIVE_CLIENT).")
    source = next(iter(sources))
    now = clock.utc_now()
    if attempt.status in attempt_service.TERMINAL and not (attempt.submitted_at and now < attempt.submitted_at + LATE_EVENT_WINDOW):
        raise AppError("ATTEMPT_NOT_ACTIVE", "Attempt is no longer accepting events.")
    db.execute(select(type(attempt).id).where(type(attempt).id == attempt.id).with_for_update())
    existing = set(db.scalars(select(SecurityEvent.sequence_number).where(
        SecurityEvent.attempt_id == attempt.id, SecurityEvent.source == source)))
    accepted = duplicates = 0
    rejected = []
    order = sorted(events, key=lambda e: e.get("clientSequence") if isinstance(e.get("clientSequence"), int) else 10**9)
    for raw in order:
        try:
            v = validate_event(raw, now, s, attempt.started_at)  # client severity yahan ignore
        except AppError as err:
            rejected.append({"clientSequence": raw.get("clientSequence"), "code": err.code})
            continue
        if v.sequence in existing:
            duplicates += 1
            continue
        existing.add(v.sequence)
        sev = severity_for(weight_for(v.event_type, v.metadata))
        ev = audit_service.append_security_event(db, attempt.id, v.event_type, sev, source, v.occurred_at,
                                                 v.sequence, v.metadata, now)
        risk_service.apply_event(db, attempt, ev)
        accepted += 1
    db.commit()
    return {"source": source, "acknowledgedUpTo": _acknowledged(db, attempt.id, source), "accepted": accepted,
            "duplicates": duplicates, "rejected": rejected}
