from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from app.errors import AppError
from app.events.risk_rules import risk_level
from app.models.attempt import Attempt
from app.models.exam import Exam
from app.models.review import ReviewAssignment, ReviewDecision
from app.models.security_event import SecurityEvent
from app.models.user import User
from app.schemas.review import DECISIONS, decision_out
from app.security.permissions import Role
from app.security.policies import can_manage_exam, can_review_attempt, ensure
from app.services import audit_service, notification_service, risk_service, submission_service
from app.utils.clock import to_iso

LEVEL_RANGE = {"NORMAL": (0, 19), "WARNING": (20, 39), "REVIEW_REQUIRED": (40, 59), "HIGH_RISK": (60, 10**9)}


def _reviewable_attempt(db, user, attempt_id) -> Attempt:
    a = db.get(Attempt, attempt_id)
    ensure(a is not None and can_review_attempt(user, a, db))  # unassigned/foreign -> 404
    return a


def queue(db: Session, user, filters: dict, page: int, page_size: int):
    last_event = select(SecurityEvent.attempt_id, func.max(SecurityEvent.occurred_at).label("last_at")) \
        .group_by(SecurityEvent.attempt_id).subquery()
    q = (select(Attempt, Exam, User, last_event.c.last_at).join(Exam, Exam.id == Attempt.exam_id)
         .join(User, User.id == Attempt.student_id).outerjoin(last_event, last_event.c.attempt_id == Attempt.id)
         .where(or_(Attempt.risk_score > 0, Attempt.needs_review.is_(True), Attempt.status == "UNDER_REVIEW")))
    if user.role == Role.INSTRUCTOR.value:
        q = q.where(Exam.created_by == user.id)
    elif user.role == Role.REVIEWER.value:
        q = q.where(Attempt.id.in_(select(ReviewAssignment.attempt_id).where(ReviewAssignment.reviewer_id == user.id)))
    if filters.get("status"):
        q = q.where(Attempt.status == filters["status"])
    if filters.get("examId"):
        q = q.where(Attempt.exam_id == filters["examId"])
    if filters.get("riskLevel"):
        lo, hi = LEVEL_RANGE.get(filters["riskLevel"], (0, -1))
        q = q.where(Attempt.risk_score >= lo, Attempt.risk_score <= hi)
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    rows = db.execute(q.order_by(Attempt.risk_score.desc(), Attempt.started_at.desc(), Attempt.id)
                      .offset((page - 1) * page_size).limit(page_size)).all()
    items = [{"attemptId": a.id, "examTitle": e.title, "studentName": u.full_name, "status": a.status,
              "riskScore": a.risk_score, "riskLevel": risk_level(a.risk_score), "needsReview": a.needs_review,
              "lastEventAt": to_iso(last)} for a, e, u, last in rows]
    return items, total


def assign(db: Session, user, attempt_id: str, reviewer_id: str) -> dict:
    a = db.get(Attempt, attempt_id)
    ensure(a is not None and can_manage_exam(user, a.exam))
    reviewer = db.get(User, reviewer_id)
    if reviewer is None or reviewer.role != Role.REVIEWER.value or not reviewer.is_active:
        raise AppError("VALIDATION_ERROR", "reviewerId must be an active reviewer.")
    if not db.scalar(select(ReviewAssignment).where(ReviewAssignment.attempt_id == a.id, ReviewAssignment.reviewer_id == reviewer.id)):
        db.add(ReviewAssignment(attempt_id=a.id, reviewer_id=reviewer.id))
        notification_service.notify(db, reviewer.id, "REVIEW_ASSIGNED", "Review assigned", f"An attempt in '{a.exam.title}' was assigned to you.")
        audit_service.append_audit(db, "REVIEW_ASSIGNED", actor_id=user.id, attempt_id=a.id, details={"reviewerId": reviewer.id})
    db.commit()
    return {"attemptId": a.id, "reviewerId": reviewer.id, "assigned": True}


def _decisions(db, attempt_id) -> list[dict]:
    rows = db.execute(select(ReviewDecision, User.full_name).join(User, User.id == ReviewDecision.reviewer_id)
                      .where(ReviewDecision.attempt_id == attempt_id).order_by(ReviewDecision.created_at, ReviewDecision.id)).all()
    return [decision_out(d, n) for d, n in rows]


def timeline(db: Session, user, attempt_id: str) -> dict:
    a = _reviewable_attempt(db, user, attempt_id)
    events = db.scalars(select(SecurityEvent).where(SecurityEvent.attempt_id == a.id).order_by(SecurityEvent.chain_index)).all()
    return {"attempt": {"id": a.id, "examTitle": a.exam.title, "studentName": a.student.full_name, "status": a.status,
                        "startedAt": to_iso(a.started_at), "submittedAt": to_iso(a.submitted_at)},
            "riskScore": a.risk_score, "riskLevel": risk_level(a.risk_score), "reasons": risk_service.explain(db, a.id),
            "events": [audit_service.event_item(e) for e in events], "decisions": _decisions(db, a.id)}


def _check_reason(reason: str) -> str:
    reason = (reason or "").strip()
    if len(reason) < 5:
        raise AppError("VALIDATION_ERROR", "Reason must be at least 5 characters.")
    return reason


def record_decision(db: Session, user, attempt_id: str, decision: str, reason: str) -> dict:
    a = _reviewable_attempt(db, user, attempt_id)
    if decision not in DECISIONS:
        raise AppError("VALIDATION_ERROR", "Unknown decision.")
    reason = _check_reason(reason)
    d = ReviewDecision(attempt_id=a.id, reviewer_id=user.id, decision=decision, reason=reason)
    db.add(d)
    if decision in ("NO_ISSUE", "INVALID_FLAG"):
        a.needs_review = False
    audit_service.append_audit(db, "REVIEW_DECISION", actor_id=user.id, attempt_id=a.id, details={"decision": decision, "reason": reason})
    if a.exam.created_by != user.id:
        notification_service.notify(db, a.exam.created_by, "REVIEW_DECISION", "Review decision recorded", f"Decision: {decision}")
    db.flush()
    if a.status == "UNDER_REVIEW":  # state change sirf UNDER_REVIEW pe
        if decision in ("NO_ISSUE", "INVALID_FLAG"):
            submission_service.submit_attempt(db, a, "ADMIN_ACTION")
        elif decision == "POLICY_VIOLATION":
            submission_service.submit_attempt(db, a, "POLICY_TERMINATION")
    db.commit()
    return decision_out(d, user.full_name)


def file_appeal(db: Session, student, attempt_id: str, reason: str) -> dict:
    a = db.get(Attempt, attempt_id)
    ensure(a is not None and a.student_id == student.id)
    if a.status == "ACTIVE":
        raise AppError("REVIEW_NOT_ALLOWED", "You can appeal once the attempt is no longer active.")
    reason = _check_reason(reason)
    d = ReviewDecision(attempt_id=a.id, reviewer_id=student.id, decision="NEEDS_CLARIFICATION", reason=reason, is_appeal=True)
    db.add(d)
    notification_service.notify(db, a.exam.created_by, "APPEAL_FILED", "Appeal filed", f"A student filed an appeal for '{a.exam.title}'.")
    audit_service.append_audit(db, "APPEAL_FILED", actor_id=student.id, attempt_id=a.id)
    db.commit()
    return {"id": d.id, "isAppeal": True, "createdAt": to_iso(d.created_at)}  # student ko internal decisions nahi


def verify(db: Session, user, attempt_id: str) -> dict:
    return audit_service.verify_chain(db, _reviewable_attempt(db, user, attempt_id).id)


def export(db: Session, user, attempt_id: str) -> dict:
    return audit_service.export_attempt_audit(db, _reviewable_attempt(db, user, attempt_id).id)
