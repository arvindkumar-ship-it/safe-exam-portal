from sqlalchemy import select
from sqlalchemy.orm import Session
from app.errors import AppError
from app.models.exam_question import ExamQuestion
from app.models.question import Question
from app.security.permissions import Role
from app.security.policies import ensure
from app.services import exam_service


def list_exam_questions(db: Session, exam_id: str) -> list[ExamQuestion]:
    return list(db.scalars(select(ExamQuestion).where(ExamQuestion.exam_id == exam_id).order_by(ExamQuestion.position)).unique())


def _draft_exam(db, user, exam_id):
    exam = exam_service.get_exam_for_manage(db, user, exam_id)
    if exam.status != "DRAFT":
        raise AppError("EXAM_NOT_EDITABLE", "Questions can only be changed while the exam is a draft.")
    return exam


def _renumber(rows):
    for i, r in enumerate(rows, 1):
        r.position = i


def attach_question(db: Session, user, exam_id: str, question_id: str, position=None, marks=None, required=True):
    _draft_exam(db, user, exam_id)
    q = db.get(Question, question_id)
    ensure(q is not None and (user.role == Role.ADMIN.value or q.created_by == user.id))
    if not q.is_active:
        raise AppError("VALIDATION_ERROR", "Inactive question cannot be attached.")
    rows = list_exam_questions(db, exam_id)
    if any(r.question_id == question_id for r in rows):
        raise AppError("VALIDATION_ERROR", "Question already attached.", 409)
    eq = ExamQuestion(exam_id=exam_id, question_id=question_id, position=0, marks=marks, required=required)
    idx = len(rows) if position is None else max(0, min(position - 1, len(rows)))
    rows.insert(idx, eq)
    db.add(eq)
    _renumber(rows)
    db.commit()
    return eq


def detach_question(db: Session, user, exam_id: str, question_id: str) -> None:
    _draft_exam(db, user, exam_id)
    rows = list_exam_questions(db, exam_id)
    target = next((r for r in rows if r.question_id == question_id), None)
    ensure(target is not None)
    rows.remove(target)
    db.delete(target)
    _renumber(rows)
    db.commit()


def reorder(db: Session, user, exam_id: str, question_ids: list[str]):
    _draft_exam(db, user, exam_id)
    rows = list_exam_questions(db, exam_id)
    by_q = {r.question_id: r for r in rows}
    if len(question_ids) != len(rows) or set(question_ids) != set(by_q):
        raise AppError("VALIDATION_ERROR", "questionIds must list every attached question exactly once.")
    _renumber([by_q[i] for i in question_ids])
    db.commit()
    return list_exam_questions(db, exam_id)


def build_snapshot(question: Question, coding_extra: dict | None = None) -> dict:
    """Question ka poora rup us waqt ka (publish pe freeze)."""
    snap = {"id": question.id, "type": question.question_type, "prompt": question.prompt,
            "options": question.options, "correctAnswer": question.correct_answer,
            "explanation": question.explanation, "marks": float(question.marks),
            "negativeMarks": float(question.negative_marks), "version": question.version}
    if question.question_type == "CODING":
        snap["coding"] = question.coding
        snap.update(coding_extra or {})  # samples, testsHash, testCount, totalWeight
    return snap
