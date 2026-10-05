from datetime import datetime, timezone


def utc_now() -> datetime:
    """Poore project me time sirf yahin se (tests isko monkeypatch karte hain)."""
    return datetime.now(timezone.utc)


def to_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
