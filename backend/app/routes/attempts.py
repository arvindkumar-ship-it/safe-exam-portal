from fastapi import APIRouter, Depends, Header, Query, Request
from sqlalchemy.orm import Session
from app.dependencies import get_db
from app.errors import ok
from app.schemas.attempt import StartIn, attempt_summary
from app.security.permissions import Role, require_roles
from app.services import attempt_service, submission_service, time_service
from app.utils import clock

router = APIRouter(prefix="/attempts", tags=["attempts"])
student_only = require_roles(Role.STUDENT)


@router.post("/start")
def start(body: StartIn, request: Request, user=Depends(student_only), db: Session = Depends(get_db)):
    attempt = attempt_service.start_attempt(db, user, body.exam_id)
    return ok(attempt_service.attempt_view(db, attempt), request)


@router.get("/mine")
def mine(request: Request, examId: str | None = Query(None), user=Depends(student_only), db: Session = Depends(get_db)):
    return ok([attempt_summary(a) for a in attempt_service.list_mine(db, user, examId)], request)


@router.get("/{attempt_id}")
def get_one(attempt_id: str, request: Request, user=Depends(student_only), db: Session = Depends(get_db)):
    attempt = attempt_service.get_attempt_for_student(db, user, attempt_id)
    time_service.expire_if_needed(db, attempt)  # resume pe expired ho toh pehle auto-submit
    return ok(attempt_service.attempt_view(db, attempt), request)


@router.post("/{attempt_id}/submit")
def submit(attempt_id: str, request: Request, idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
           user=Depends(student_only), db: Session = Depends(get_db)):
    attempt = attempt_service.get_attempt_for_student(db, user, attempt_id)
    sub = submission_service.submit_attempt(db, attempt, "MANUAL", idempotency_key)
    return ok(submission_service.get_receipt(sub), request)


@router.post("/{attempt_id}/heartbeat")
def heartbeat(attempt_id: str, request: Request, user=Depends(student_only), db: Session = Depends(get_db)):
    attempt = attempt_service.get_attempt_for_student(db, user, attempt_id)
    time_service.expire_if_needed(db, attempt)
    db.refresh(attempt)
    # client ka koi time/header use nahi hota
    return ok({"serverTime": clock.to_iso(clock.utc_now()), "expiresAt": clock.to_iso(attempt.expires_at),
               "attemptStatus": attempt.status}, request)
