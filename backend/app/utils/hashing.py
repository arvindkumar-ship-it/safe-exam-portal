import hashlib
import json

GENESIS = "0" * 64


def compute_event_hash(previous_hash: str, event_type: str, occurred_at_iso: str, metadata: dict) -> str:
    """Tamper EVIDENCE (encryption nahi): har record pichle ke hash se bandha hai."""
    payload = previous_hash + event_type + occurred_at_iso + json.dumps(metadata, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()
