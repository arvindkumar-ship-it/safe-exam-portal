from app.schemas.common import CamelModel
from app.utils.clock import to_iso

DECISIONS = {"NO_ISSUE", "NEEDS_CLARIFICATION", "POLICY_VIOLATION", "INVALID_FLAG"}


class AssignIn(CamelModel):
    reviewer_id: str


class DecisionIn(CamelModel):
    decision: str
    reason: str


class AppealIn(CamelModel):
    reason: str


def decision_out(d, reviewer_name: str | None = None) -> dict:
    return {"id": d.id, "reviewerId": d.reviewer_id, "reviewerName": reviewer_name, "decision": d.decision,
            "reason": d.reason, "isAppeal": d.is_appeal, "createdAt": to_iso(d.created_at)}
