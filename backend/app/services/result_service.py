from sqlalchemy import select
from sqlalchemy.orm import Session
from app.errors import AppError
from app.events.risk_rules import risk_level
from app.models.attempt import Attempt
from app.models.result import Result
from app.models.submission import Submission
from app.models.user import User
from app.security.permissions import Role
from app.security.policies import can_manage_exam, ensure
from app.services import audit_service, evaluation_service, exam_service, notification_service
from app.utils.clock import to_iso


def result_out(r: Result, student: bool = False) -> dict:
    d = {"attemptId": r.attempt_id, "totalMarks": float(r.total_marks), "maxMarks": float(r.max_marks), "passed": r.passed,
         "breakdown": r.breakdown, "evaluatedAt": to_iso(r.evaluated_at)}
    if not student:
        d.update({"needsManualReview": r.needs_manual_review, "published": r.published})
    return d


def _result(db, attempt_id) -> Result | None:
    return db.scalar(select(Result).where(Result.attempt_id == attempt_id))


def get_student_result(db: Session, student, attempt_id: str) -> dict:
    attempt = db.get(Attempt, attempt_id)
    ensure(attempt is not None and attempt.student_id == student.id)
    res = _result(db, attempt_id)
    if not attempt.exam.show_result or res is None or not res.published:
        raise AppError("RESULT_NOT_AVAILABLE", "Result is not available yet.")
    return result_out(res, student=True)


def get_result_for_user(db: Session, user, attempt_id: str) -> dict:
    if user.role == Role.STUDENT.value:
        return get_student_result(db, user, attempt_id)
    attempt = db.get(Attempt, attempt_id)
    ensure(attempt is not None and can_manage_exam(user, attempt.exam))
    res = _result(db, attempt_id)
    ensure(res is not None)
    return result_out(res)


def list_exam_results(db: Session, user, exam_id: str) -> list[dict]:
    exam_service.get_exam_for_manage(db, user, exam_id)
    rows = db.execute(select(Attempt, User, Result).join(User, User.id == Attempt.student_id)
                      .outerjoin(Result, Result.attempt_id == Attempt.id).where(Attempt.exam_id == exam_id)
                      .order_by(User.email, Attempt.started_at)).all()
    return [{"attemptId": a.id, "studentEmail": u.email, "studentName": u.full_name, "attemptStatus": a.status,
             "totalMarks": float(r.total_marks) if r else None, "maxMarks": float(r.max_marks) if r else None,
             "passed": r.passed if r else None, "riskLevel": risk_level(a.risk_score),
             "published": r.published if r else False, "needsManualReview": r.needs_manual_review if r else False}
            for a, u, r in rows]


def publish_results(db: Session, user, exam_id: str) -> dict:
    exam = exam_service.get_exam_for_manage(db, user, exam_id)
    submitted = db.scalars(select(Attempt).join(Submission, Submission.attempt_id == Attempt.id).where(Attempt.exam_id == exam_id)).all()
    count = 0
    for a in submitted:
        res = _result(db, a.id) or evaluation_service.evaluate_attempt(db, a.id)
        if not res.published:
            res.published = True
            notification_service.notify(db, a.student_id, "RESULT_PUBLISHED", "Result published",
                                        f"Your result for '{exam.title}' is available.")
        count += 1
    audit_service.append_audit(db, "RESULTS_PUBLISHED", actor_id=user.id, details={"examId": exam_id, "count": count})
    db.commit()
    return {"published": count}


def re_evaluate(db: Session, user, attempt_id: str) -> dict:
    attempt = db.get(Attempt, attempt_id)
    ensure(attempt is not None and can_manage_exam(user, attempt.exam))
    old = _result(db, attempt_id)
    was_published = old.published if old else False
    res = evaluation_service.evaluate_attempt(db, attempt_id)
    res.published = was_published
    audit_service.append_audit(db, "RESULT_RE_EVALUATED", actor_id=user.id, attempt_id=attempt_id,
                               details={"previous": float(old.total_marks) if old else None, "new": float(res.total_marks)})
    db.commit()
    return result_out(res)
