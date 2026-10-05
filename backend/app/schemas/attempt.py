from app.schemas.common import CamelModel
from app.utils.clock import to_iso


class StartIn(CamelModel):
    exam_id: str


def attempt_summary(a) -> dict:
    return {"id": a.id, "examId": a.exam_id, "status": a.status, "startedAt": to_iso(a.started_at),
            "expiresAt": to_iso(a.expires_at), "submittedAt": to_iso(a.submitted_at)}
