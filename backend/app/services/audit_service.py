import logging
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session
from app.models.attempt import Attempt
from app.models.audit_record import AuditRecord
from app.models.security_event import SecurityEvent
from app.utils import clock
from app.utils.clock import to_iso
from app.utils.hashing import GENESIS, compute_event_hash

log = logging.getLogger("safeexam.audit")
SENSITIVE = {"password", "passwd", "token", "accesstoken", "refreshtoken", "secret", "authorization", "cookie",
             "text", "content", "clipboard", "clipboardtext", "clipboarddata"}


def strip_sensitive(data):
    """password/token/clipboard text kabhi store nahi (nested bhi)."""
    if isinstance(data, dict):
        return {k: strip_sensitive(v) for k, v in data.items() if k.replace("_", "").lower() not in SENSITIVE}
    if isinstance(data, list):
        return [strip_sensitive(v) for v in data]
    return data


def append_security_event(db: Session, attempt_id: str, event_type: str, severity: str, source: str, occurred_at,
                          sequence_number: int, metadata: dict | None = None, received_at=None) -> SecurityEvent:
    db.execute(select(Attempt.id).where(Attempt.id == attempt_id).with_for_update())  # per-attempt row lock
    last = db.scalar(select(SecurityEvent).where(SecurityEvent.attempt_id == attempt_id)
                     .order_by(SecurityEvent.chain_index.desc()).limit(1))
    meta = strip_sensitive(metadata or {})
    prev = last.event_hash if last else GENESIS
    ev = SecurityEvent(attempt_id=attempt_id, chain_index=(last.chain_index + 1) if last else 1, event_type=event_type,
                       severity=severity, source=source, occurred_at=occurred_at, received_at=received_at or clock.utc_now(),
                       sequence_number=sequence_number, event_metadata=meta, previous_hash=prev,
                       event_hash=compute_event_hash(prev, event_type, to_iso(occurred_at), meta))
    db.add(ev)
    db.flush()
    return ev


def append_audit(db: Session, action: str, actor_id: str | None = None, attempt_id: str | None = None,
                 details: dict | None = None) -> AuditRecord:
    """Global hash chain. Caller commit karta hai (lock tab tak rehta hai)."""
    db.execute(text("SELECT pg_advisory_xact_lock(7001)"))
    last = db.scalar(select(AuditRecord).order_by(AuditRecord.chain_index.desc()).limit(1))
    now, det = clock.utc_now(), strip_sensitive(details or {})
    prev = last.record_hash if last else GENESIS
    rec = AuditRecord(attempt_id=attempt_id, actor_id=actor_id, action=action, details=det, previous_hash=prev,
                      record_hash=compute_event_hash(prev, action, to_iso(now), det), created_at=now,
                      chain_index=(last.chain_index + 1) if last else 1)
    db.add(rec)
    db.flush()
    return rec


def verify_chain(db: Session, attempt_id: str) -> dict:
    events = db.scalars(select(SecurityEvent).where(SecurityEvent.attempt_id == attempt_id).order_by(SecurityEvent.chain_index)).all()
    prev = GENESIS
    for i, e in enumerate(events, 1):
        expected = compute_event_hash(prev, e.event_type, to_iso(e.occurred_at), e.event_metadata)
        if e.chain_index != i or e.previous_hash != prev or e.event_hash != expected:
            return {"valid": False, "brokenAt": e.chain_index}
        prev = e.event_hash
    return {"valid": True, "brokenAt": None}


def event_item(e: SecurityEvent) -> dict:
    from app.events.risk_rules import weight_for
    return {"occurredAt": to_iso(e.occurred_at), "eventType": e.event_type, "source": e.source, "severity": e.severity,
            "weight": weight_for(e.event_type, e.event_metadata), "metadata": e.event_metadata, "chainIndex": e.chain_index}


def export_attempt_audit(db: Session, attempt_id: str) -> dict:
    events = db.scalars(select(SecurityEvent).where(SecurityEvent.attempt_id == attempt_id).order_by(SecurityEvent.chain_index)).all()
    records = db.scalars(select(AuditRecord).where(AuditRecord.attempt_id == attempt_id).order_by(AuditRecord.chain_index)).all()
    return {"attemptId": attempt_id, "exportedAt": to_iso(clock.utc_now()), "verification": verify_chain(db, attempt_id),
            "events": [{**event_item(e), "eventHash": e.event_hash, "previousHash": e.previous_hash} for e in events],
            "auditRecords": [{"action": r.action, "actorId": r.actor_id, "details": r.details,
                              "createdAt": to_iso(r.created_at), "recordHash": r.record_hash} for r in records]}
