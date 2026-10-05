from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session
from app.dependencies import get_db
from app.errors import ok
from app.schemas.question import QuestionCreateIn, QuestionUpdateIn, question_out
from app.security.permissions import Role, require_roles
from app.services import question_service as qs
from app.utils.pagination import PageParams, page_out

router = APIRouter(prefix="/questions", tags=["questions"])
manager = require_roles(Role.INSTRUCTOR, Role.ADMIN)


@router.post("", status_code=201)
def create(body: QuestionCreateIn, request: Request, user=Depends(manager), db: Session = Depends(get_db)):
    return ok(question_out(qs.create_question(db, user, body.model_dump())), request)


@router.get("")
def list_(request: Request, p: PageParams = Depends(), includeInactive: bool = Query(False),
          user=Depends(manager), db: Session = Depends(get_db)):
    rows, total = qs.list_questions(db, user, p.page, p.page_size, includeInactive)
    return ok(page_out([question_out(q) for q in rows], p.page, p.page_size, total), request)


@router.get("/{qid}")
def get_one(qid: str, request: Request, user=Depends(manager), db: Session = Depends(get_db)):
    return ok(question_out(qs.get_question(db, user, qid)), request)


@router.patch("/{qid}")
def update(qid: str, body: QuestionUpdateIn, request: Request, user=Depends(manager), db: Session = Depends(get_db)):
    return ok(question_out(qs.update_question(db, user, qid, body.model_dump(exclude_unset=True))), request)


@router.delete("/{qid}")
def delete(qid: str, request: Request, user=Depends(manager), db: Session = Depends(get_db)):
    return ok(question_out(qs.deactivate_question(db, user, qid)), request)
