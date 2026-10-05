from decimal import Decimal
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.errors import AppError
from app.models.exam import Exam
from app.models.exam_question import ExamQuestion
from app.models.question import Question
from app.security.permissions import Role
from app.security.policies import ensure


def _bad(msg):
    raise AppError("VALIDATION_ERROR", msg)


def validate_question_payload(qtype: str, options, correct_answer) -> None:
    if qtype == "SHORT_TEXT":
        if options is not None:
            _bad("SHORT_TEXT must not have options.")
        ok = correct_answer is None or isinstance(correct_answer, str) or (
            isinstance(correct_answer, list) and all(isinstance(x, str) for x in correct_answer))
        if not ok:
            _bad("correctAnswer must be string, list of strings, or null.")
        return
    if qtype not in ("MCQ_SINGLE", "MCQ_MULTIPLE"):
        _bad("Unknown question type.")
    if not isinstance(options, list) or len(options) < 2:
        _bad("At least 2 options are required.")
    ids = []
    for o in options:
        if not isinstance(o, dict) or not isinstance(o.get("id"), str) or not o["id"] or not isinstance(o.get("text"), str):
            _bad("Each option needs string 'id' and 'text'.")
        ids.append(o["id"])
    if len(set(ids)) != len(ids):
        _bad("Option ids must be unique.")
    if qtype == "MCQ_SINGLE":
        if not isinstance(correct_answer, str) or correct_answer not in ids:
            _bad("correctAnswer must be exactly one valid option id.")
    else:
        if (not isinstance(correct_answer, list) or not correct_answer or len(set(correct_answer)) != len(correct_answer)
                or not set(correct_answer) <= set(ids)):
            _bad("correctAnswer must be a non-empty subset of option ids.")


def _mine(db, user, qid) -> Question:
    q = db.get(Question, qid)
    ensure(q is not None and (user.role == Role.ADMIN.value or q.created_by == user.id))
    return q


def create_question(db: Session, user, data: dict) -> Question:
    validate_question_payload(data["question_type"], data.get("options"), data.get("correct_answer"))
    q = Question(**data, created_by=user.id)
    db.add(q)
    db.commit()
    return q


def get_question(db: Session, user, qid: str) -> Question:
    return _mine(db, user, qid)


def update_question(db: Session, user, qid: str, data: dict) -> Question:
    q = _mine(db, user, qid)
    for k, v in data.items():
        if v is None and k in ("prompt", "marks", "negative_marks"):
            continue
        setattr(q, k, v)
    validate_question_payload(q.question_type, q.options, q.correct_answer)
    q.version += 1  # har update pe
    db.commit()
    return q


def deactivate_question(db: Session, user, qid: str) -> Question:
    q = _mine(db, user, qid)
    used = db.scalar(select(func.count()).select_from(ExamQuestion).join(Exam, Exam.id == ExamQuestion.exam_id)
                     .where(ExamQuestion.question_id == qid, Exam.status != "DRAFT"))
    if used:
        raise AppError("QUESTION_IN_USE", "Question is used in a published exam.")
    q.is_active = False
    db.commit()
    return q


def list_questions(db: Session, user, page: int, page_size: int, include_inactive: bool = False):
    stmt = select(Question)
    if user.role != Role.ADMIN.value:
        stmt = stmt.where(Question.created_by == user.id)
    if not include_inactive:
        stmt = stmt.where(Question.is_active.is_(True))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(Question.created_at.desc(), Question.id).offset((page - 1) * page_size).limit(page_size)).all()
    return list(rows), total


def to_student_view(q) -> dict:
    """Question ORM ya snapshot dict dono chalta hai. correctAnswer/explanation kabhi nahi."""
    d = q if isinstance(q, dict) else {"id": q.id, "type": q.question_type, "prompt": q.prompt,
                                       "options": q.options, "marks": float(q.marks)}
    return {"id": d["id"], "type": d["type"], "prompt": d["prompt"], "options": d.get("options"), "marks": d["marks"]}
