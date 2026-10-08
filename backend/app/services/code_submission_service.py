import hashlib
from decimal import Decimal
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session
from app.config import get_settings
from app.errors import AppError
from app.models.attempt import Attempt
from app.models.base import new_id
from app.models.code_submission import CodeSubmission
from app.models.exam_question import ExamQuestion
from app.models.submission import Submission
from app.security.policies import ensure
from app.services import attempt_service, time_service
from app.services.scoring_rules import ZERO, _d
from app.utils import clock

_INFLIGHT = ("QUEUED", "JUDGING")


def _snapshot(db: Session, attempt: Attempt, question_id: str) -> dict:
    ensure(question_id in {o["questionId"] for o in attempt.question_order})
    snap = db.scalar(select(ExamQuestion.snapshot).where(ExamQuestion.exam_id == attempt.exam_id,
                                                         ExamQuestion.question_id == question_id))
    if not snap or snap.get("type") != "CODING":
        raise AppError("VALIDATION_ERROR", "Not a coding question.")
    return snap


def submit_code(db: Session, student, attempt_id: str, question_id: str, language: str, source: str, mode: str) -> CodeSubmission:
    s = get_settings()
    attempt = attempt_service.get_attempt_for_student(db, student, attempt_id)
    time_service.ensure_not_expired(db, attempt)
    # attempt row lock: ek attempt ke submissions serial -> throttle checks race-free
    db.execute(select(Attempt.id).where(Attempt.id == attempt.id).with_for_update())
    db.refresh(attempt)
    if attempt.status != "ACTIVE" or time_service.is_expired(attempt):
        db.rollback()
        raise AppError("ATTEMPT_ALREADY_SUBMITTED" if attempt.status in attempt_service.TERMINAL else "ATTEMPT_NOT_ACTIVE",
                       "Attempt is not accepting submissions.")
    try:
        snap = _snapshot(db, attempt, question_id)
        cfg = snap["coding"]
        if language not in cfg["languages"]:
            raise AppError("VALIDATION_ERROR", "Language is not allowed for this question.")
        if not source.strip() or "\x00" in source:
            raise AppError("VALIDATION_ERROR", "Source is empty or contains invalid characters.")
        if len(source.encode("utf-8")) > s.CODE_MAX_SOURCE_BYTES:
            raise AppError("VALIDATION_ERROR", f"Source exceeds {s.CODE_MAX_SOURCE_BYTES} bytes.")
        now = clock.utc_now()
        cs = CodeSubmission
        inflight = db.scalar(select(func.count()).select_from(cs).where(cs.attempt_id == attempt.id, cs.status.in_(_INFLIGHT)))
        if inflight >= s.CODE_MAX_INFLIGHT:
            raise AppError("RATE_LIMITED", "Wait for your previous submissions to finish.")
        last = db.scalar(select(func.max(cs.created_at)).where(cs.attempt_id == attempt.id, cs.question_id == question_id))
        if last is not None and (now - last).total_seconds() < s.CODE_MIN_INTERVAL_SECONDS:
            raise AppError("RATE_LIMITED", "You are submitting too fast.")
        used = db.scalar(select(func.count()).select_from(cs).where(cs.attempt_id == attempt.id, cs.question_id == question_id, cs.mode == mode))
        if used >= (s.CODE_MAX_SUBMITS_PER_QUESTION if mode == "SUBMIT" else s.CODE_MAX_RUNS_PER_QUESTION):
            raise AppError("SUBMISSION_LIMIT_REACHED", "Submission limit reached for this question.")
        sha = hashlib.sha256(source.encode("utf-8")).hexdigest()
        if mode == "SUBMIT" and db.scalar(select(cs.id).where(cs.attempt_id == attempt.id, cs.question_id == question_id,
                                                              cs.mode == "SUBMIT", cs.language == language,
                                                              cs.source_sha256 == sha).limit(1)):
            raise AppError("DUPLICATE_SUBMISSION", "You have already submitted exactly the same code.")
        row = cs(id=new_id(), attempt_id=attempt.id, question_id=question_id, student_id=student.id, language=language,
                 mode=mode, source=source, source_sha256=sha, status="QUEUED", priority=0 if mode == "RUN" else 1,
                 total=len(snap.get("samples", [])) if mode == "RUN" else int(snap["testCount"]),
                 max_score=_d(snap["marks"]) if mode == "SUBMIT" else ZERO, queued_at=now, created_at=now)
        db.add(row)
        db.execute(text("SELECT pg_notify('judge_queue', :id)"), {"id": row.id})  # commit pe worker jaag jaata hai
        db.commit()
        return row
    except Exception:
        db.rollback()
        raise


def get_for_student(db: Session, student, attempt_id: str, sid: str) -> CodeSubmission:
    attempt = attempt_service.get_attempt_for_student(db, student, attempt_id)
    row = db.get(CodeSubmission, sid)
    ensure(row is not None and row.attempt_id == attempt.id)
    return row


def list_for_student(db: Session, student, attempt_id: str, question_id: str | None, limit: int) -> list[CodeSubmission]:
    attempt = attempt_service.get_attempt_for_student(db, student, attempt_id)
    stmt = select(CodeSubmission).where(CodeSubmission.attempt_id == attempt.id)
    if question_id:
        stmt = stmt.where(CodeSubmission.question_id == question_id)
    return list(db.scalars(stmt.order_by(CodeSubmission.created_at.desc()).limit(max(1, min(limit, 100)))))


def score_for_evaluation(db: Session, attempt_id: str, question_id: str, max_marks) -> tuple[Decimal, str]:
    """Best SUBMIT score. Pending jobs hon aur best full na ho toh PENDING."""
    rows = db.execute(select(CodeSubmission.status, CodeSubmission.score).where(
        CodeSubmission.attempt_id == attempt_id, CodeSubmission.question_id == question_id,
        CodeSubmission.mode == "SUBMIT")).all()
    if not rows:
        return ZERO, "EMPTY"
    best = _d(max((sc for st, sc in rows if st == "DONE"), default=ZERO))
    full = _d(max_marks)
    if best >= full:
        return best, "CORRECT"
    if any(st != "DONE" for st, _ in rows):
        return best, "PENDING"
    return best, ("PARTIAL" if best > 0 else "WRONG")


def on_judged(db: Session, cs: CodeSubmission) -> None:
    """Judge worker finish ke baad bulata hai. Attempt already submitted ho toh result dobara evaluate."""
    if cs.mode != "SUBMIT":
        return
    if db.scalar(select(Submission.id).where(Submission.attempt_id == cs.attempt_id)):
        from app.services import evaluation_service
        evaluation_service.evaluate_attempt(db, cs.attempt_id)
