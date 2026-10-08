from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session
from app.dependencies import get_db
from app.errors import ok
from app.schemas.code_submission import CodeSubmitIn, submission_out
from app.security.permissions import Role, require_roles
from app.services import code_submission_service as css

router = APIRouter(prefix="/attempts", tags=["code"])
student_only = require_roles(Role.STUDENT)


@router.post("/{attempt_id}/code-submissions", status_code=201)
def submit(attempt_id: str, body: CodeSubmitIn, request: Request, user=Depends(student_only), db: Session = Depends(get_db)):
    row = css.submit_code(db, user, attempt_id, body.question_id, body.language, body.source, body.mode)
    return ok(submission_out(row), request)


@router.get("/{attempt_id}/code-submissions")
def list_(attempt_id: str, request: Request, questionId: str | None = Query(None), limit: int = Query(50, ge=1, le=100),
          user=Depends(student_only), db: Session = Depends(get_db)):
    return ok([submission_out(r) for r in css.list_for_student(db, user, attempt_id, questionId, limit)], request)


@router.get("/{attempt_id}/code-submissions/{sid}")
def get_one(attempt_id: str, sid: str, request: Request, user=Depends(student_only), db: Session = Depends(get_db)):
    return ok(submission_out(css.get_for_student(db, user, attempt_id, sid), with_source=True), request)
