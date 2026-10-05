from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from app.dependencies import get_db
from app.errors import ok
from app.schemas.answer import AnswerIn
from app.security.permissions import Role, require_roles
from app.services import answer_service
from app.utils.clock import to_iso

router = APIRouter(prefix="/attempts", tags=["answers"])
student_only = require_roles(Role.STUDENT)


@router.put("/{attempt_id}/answers/{question_id}")
def save(attempt_id: str, question_id: str, body: AnswerIn, request: Request,
         user=Depends(student_only), db: Session = Depends(get_db)):
    a = answer_service.save_answer(db, user, attempt_id, question_id, body.answer_value, body.version)
    return ok({"questionId": a.question_id, "version": a.version, "savedAt": to_iso(a.last_saved_at)}, request)


@router.get("/{attempt_id}/answers")
def list_(attempt_id: str, request: Request, user=Depends(student_only), db: Session = Depends(get_db)):
    return ok(answer_service.list_answers(db, user, attempt_id), request)
