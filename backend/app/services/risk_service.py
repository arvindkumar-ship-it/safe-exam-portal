from collections import defaultdict
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.events.risk_rules import EVENT_WEIGHTS, risk_level, severity_for, weight_for  # noqa: F401 (re-export)
from app.models.security_event import SecurityEvent
from app.services import attempt_service, notification_service


def apply_event(db: Session, attempt, event) -> int:
    """Risk update. Auto-terminate kabhi nahi; sirf policy ho toh UNDER_REVIEW. Commit caller karta hai."""
    w = weight_for(event.event_type, event.event_metadata)
    attempt.risk_score = (attempt.risk_score or 0) + w
    if attempt.risk_score >= 40:
        attempt.needs_review = True
    exam = attempt.exam
    if exam.lock_on_high_risk and risk_level(attempt.risk_score) == "HIGH_RISK" and attempt.status == "ACTIVE":
        attempt_service.transition_attempt(db, attempt, "UNDER_REVIEW")
        notification_service.notify(db, exam.created_by, "ATTEMPT_UNDER_REVIEW", "Attempt needs review",
                                    f"An attempt in '{exam.title}' was paused for review.")
    return w


def explain(db: Session, attempt_id: str) -> list[str]:
    counts, totals = defaultdict(int), defaultdict(int)
    for e in db.scalars(select(SecurityEvent).where(SecurityEvent.attempt_id == attempt_id)):
        w = weight_for(e.event_type, e.event_metadata)
        if w:
            counts[e.event_type] += 1
            totals[e.event_type] += w
    return [f"{counts[t]} × {t} (+{totals[t]})" for t in sorted(totals, key=lambda t: (-totals[t], t))]
