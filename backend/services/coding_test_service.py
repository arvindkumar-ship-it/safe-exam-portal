import hashlib
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.config import get_settings
from app.errors import AppError
from app.models.coding_test import CodingTest
from app.models.exam import Exam
from app.models.exam_question import ExamQuestion
from app.models.question import Question
from app.services import question_service as qs


def _bad(msg):
    raise AppError("VALIDATION_ERROR", msg)


def _coding_question(db: Session, user, qid: str, write: bool) -> Question:
    q = qs._mine(db, user, qid)
    if q.question_type != "CODING":
        _bad("Not a coding question.")
    if write:
        db.execute(select(Question.id).where(Question.id == qid).with_for_update())  # position race
        used = db.scalar(select(func.count()).select_from(ExamQuestion).join(Exam, Exam.id == ExamQuestion.exam_id)
                         .where(ExamQuestion.question_id == qid, Exam.status != "DRAFT"))
        if used:
            raise AppError("QUESTION_IN_USE", "Tests cannot change: question is used in a published exam.")
    return q


def _clean(v, name: str, limit: int) -> str:
    if not isinstance(v, str) or "\x00" in v:
        _bad(f"{name} must be text without NUL characters.")
    v = v.replace("\r\n", "\n").replace("\r", "\n")
    if len(v.encode("utf-8")) > limit:
        _bad(f"{name} exceeds {limit} bytes.")
    return v


def add_tests(db: Session, user, qid: str, items: list[dict]) -> list[dict]:
    s = get_settings()
    _coding_question(db, user, qid, write=True)
    count, last = db.execute(select(func.count(), func.coalesce(func.max(CodingTest.position), 0))
                             .where(CodingTest.question_id == qid)).one()
    if count + len(items) > s.TESTS_MAX_PER_QUESTION:
        _bad(f"A question can have at most {s.TESTS_MAX_PER_QUESTION} tests.")
    rows, total = [], 0
    for i, it in enumerate(items, 1):
        inp = _clean(it["input"], f"tests[{i}].input", s.TEST_MAX_BYTES)
        out = _clean(it["output"], f"tests[{i}].output", s.TEST_MAX_BYTES)
        total += len(inp) + len(out)
        rows.append(CodingTest(question_id=qid, position=last + i, input_text=inp, output_text=out,
                               is_sample=bool(it.get("is_sample", False)), weight=int(it.get("weight", 1))))
    if total > s.TEST_UPLOAD_MAX_BYTES:
        _bad("Upload too large.")
    db.add_all(rows)
    db.commit()
    return [_meta(r) for r in rows]


def _meta(t: CodingTest) -> dict:
    return {"id": t.id, "position": t.position, "isSample": t.is_sample, "weight": t.weight,
            "inputBytes": len(t.input_text.encode("utf-8")), "outputBytes": len(t.output_text.encode("utf-8")),
            "inputPreview": t.input_text[:120], "outputPreview": t.output_text[:120]}


def list_tests(db: Session, user, qid: str) -> list[dict]:
    _coding_question(db, user, qid, write=False)
    rows = db.execute(select(CodingTest.id, CodingTest.position, CodingTest.is_sample, CodingTest.weight,
                             func.octet_length(CodingTest.input_text), func.octet_length(CodingTest.output_text),
                             func.left(CodingTest.input_text, 120), func.left(CodingTest.output_text, 120))
                      .where(CodingTest.question_id == qid).order_by(CodingTest.position)).all()
    return [{"id": r[0], "position": r[1], "isSample": r[2], "weight": r[3], "inputBytes": r[4], "outputBytes": r[5],
             "inputPreview": r[6], "outputPreview": r[7]} for r in rows]


def get_test(db: Session, user, qid: str, tid: str) -> dict:
    _coding_question(db, user, qid, write=False)
    t = db.get(CodingTest, tid)
    if t is None or t.question_id != qid:
        raise AppError("NOT_FOUND", "Not found.")
    return {**_meta(t), "input": t.input_text, "output": t.output_text}


def delete_test(db: Session, user, qid: str, tid: str) -> None:
    _coding_question(db, user, qid, write=True)
    t = db.get(CodingTest, tid)
    if t is None or t.question_id != qid:
        raise AppError("NOT_FOUND", "Not found.")
    db.delete(t)
    db.commit()


def tests_hash(rows) -> str:
    """Judge isse verify karta hai ki publish ke baad tests badle nahi."""
    h = hashlib.sha256()
    for t in rows:
        for part in (str(int(t.is_sample)), str(t.weight), t.input_text, t.output_text):
            b = part.encode("utf-8")
            h.update(len(b).to_bytes(8, "big"))
            h.update(b)
    return h.hexdigest()


def _ordered(db: Session, qid: str) -> list[CodingTest]:
    return list(db.scalars(select(CodingTest).where(CodingTest.question_id == qid).order_by(CodingTest.position)))


def publish_parts(db: Session, question: Question) -> dict:
    rows = _ordered(db, question.id)
    return {"samples": [{"input": t.input_text, "output": t.output_text} for t in rows if t.is_sample],
            "testsHash": tests_hash(rows), "testCount": len(rows), "totalWeight": sum(t.weight for t in rows)}


def publish_problems(db: Session, question: Question) -> list[str]:
    total, samples = db.execute(select(func.count(), func.count().filter(CodingTest.is_sample.is_(True)))
                                .where(CodingTest.question_id == question.id)).one()
    out = []
    if samples < 1:
        out.append("needs at least one sample test.")
    if total - samples < 1:
        out.append("needs at least one hidden (non-sample) test.")
    return out
