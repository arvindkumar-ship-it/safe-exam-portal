from sqlalchemy.orm import Session
from app.errors import AppError
from app.services import audit_service
from app.services import exam_question_service as eqs
from app.services import coding_test_service, exam_service
from app.services.question_service import validate_question_payload
from app.utils import clock


def validate_publishable(db: Session, exam) -> list[str]:
    problems = []
    if not (exam.title or "").strip():
        problems.append("Title is required.")
    if not exam.duration_seconds or exam.duration_seconds <= 0:
        problems.append("Duration must be greater than 0.")
    if exam.starts_at and exam.ends_at and exam.ends_at <= exam.starts_at:
        problems.append("End time must be after start time.")
    if exam.ends_at and exam.ends_at <= clock.utc_now():
        problems.append("End time must be in the future.")
    rows = eqs.list_exam_questions(db, exam.id)
    if not rows:
        problems.append("At least one question is required.")
    for r in rows:
        q = r.question
        label = f"Question {r.position}"
        if not q.is_active:
            problems.append(f"{label} is inactive.")
        try:
            validate_question_payload(q.question_type, q.options, q.correct_answer, q.coding)
        except AppError as e:
            problems.append(f"{label} is invalid: {e.message}")
        if q.question_type == "CODING":
            problems.extend(f"{label}: {p}" for p in coding_test_service.publish_problems(db, q))
        if float(r.marks if r.marks is not None else q.marks) <= 0:
            problems.append(f"{label} must have marks greater than 0.")
    return problems


def publish_exam(db: Session, user, exam_id: str):
    exam = exam_service.get_exam_for_manage(db, user, exam_id)
    if exam.status != "DRAFT":
        raise AppError("INVALID_STATE_TRANSITION", f"Cannot publish an exam in status {exam.status}.")
    problems = validate_publishable(db, exam)
    if problems:
        raise AppError("EXAM_NOT_PUBLISHABLE", "Exam cannot be published.", details={"problems": problems})
    for r in eqs.list_exam_questions(db, exam.id):
        extra = coding_test_service.publish_parts(db, r.question) if r.question.question_type == "CODING" else None
        snap = eqs.build_snapshot(r.question, extra)
        if r.marks is not None:
            snap["marks"] = float(r.marks)  # per-exam override
        r.snapshot = snap
    exam.status = "PUBLISHED"
    audit_service.append_audit(db, "EXAM_PUBLISHED", actor_id=user.id, details={"examId": exam.id})
    db.commit()
    return exam
