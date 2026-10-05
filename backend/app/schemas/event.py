from app.schemas.common import CamelModel


class EventsIn(CamelModel):
    events: list[dict]  # per-event validation service me (rejected[] ke liye)
