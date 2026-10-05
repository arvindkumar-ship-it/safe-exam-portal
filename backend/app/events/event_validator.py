import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from app.errors import AppError
from app.events.event_types import EVENT_TYPES


@dataclass
class ValidatedEvent:
    event_type: str
    source: str
    occurred_at: datetime
    sequence: int
    metadata: dict


def _parse_ts(value) -> datetime:
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        raise AppError("EVENT_TIMESTAMP_INVALID", "occurredAt is not a valid ISO-8601 time.")
    if dt.tzinfo is None:
        raise AppError("EVENT_TIMESTAMP_INVALID", "occurredAt must include a timezone.")
    return dt.astimezone(timezone.utc)


def validate_event(raw: dict, now: datetime, settings, attempt_started_at: datetime | None = None) -> ValidatedEvent:
    if not isinstance(raw, dict):
        raise AppError("VALIDATION_ERROR", "Event must be an object.")
    etype = raw.get("eventType")
    if etype not in EVENT_TYPES:
        raise AppError("EVENT_TYPE_UNKNOWN", "Unknown event type.")
    metadata = raw.get("metadata") or {}
    if not isinstance(metadata, dict):
        raise AppError("VALIDATION_ERROR", "metadata must be an object.")
    if len(json.dumps(metadata).encode()) > settings.EVENT_METADATA_MAX_BYTES:
        raise AppError("EVENT_METADATA_TOO_LARGE", "Event metadata is too large.")
    seq = raw.get("clientSequence")
    if not isinstance(seq, int) or isinstance(seq, bool) or seq < 1:
        raise AppError("VALIDATION_ERROR", "clientSequence must be an integer >= 1.")
    occurred = _parse_ts(raw.get("occurredAt"))
    tol = timedelta(seconds=settings.EVENT_TIMESTAMP_TOLERANCE_SECONDS)
    if occurred > now + tol or (attempt_started_at is not None and occurred < attempt_started_at - tol):
        raise AppError("EVENT_TIMESTAMP_INVALID", "occurredAt is outside the allowed range.")
    return ValidatedEvent(etype, raw.get("source"), occurred, seq, metadata)
