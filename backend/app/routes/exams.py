from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session
from app.dependencies import get_db
from app.errors import ok
from app.schemas.exam import ExamCreateIn, ExamUpdateIn, StatusIn, exam_out
from app.schemas.exam_question import AttachIn, OrderIn, exam_question_out
from app.security.permissions import Role, require_roles
from app.services import exam_question_service as eqs
from app.services import exam_service, publishing_service
from app.utils.pagination import PageParams, page_out

router = APIRouter(prefix="/exams", tags=["exams"])
manager = require_roles(Role.INSTRUCTOR, Role.ADMIN)
any_exam_user = require_roles(Role.STUDENT, Role.INSTRUCTOR, Role.ADMIN)


@router.post("", status_code=201)
def create(body: ExamCreateIn, request: Request, user=Depends(manager), db: Session = Depends(get_db)):
    return ok(exam_out(exam_service.create_exam(db, user, body.model_dump())), request)


@router.get("")
def list_(request: Request, p: PageParams = Depends(), status: str | None = Query(None),
          user=Depends(any_exam_user), db: Session = Depends(get_db)):
    rows, total = exam_service.list_exams(db, user, p.page, p.page_size, status)
    student = user.role == Role.STUDENT.value
    return ok(page_out([exam_out(e, student) for e in rows], p.page, p.page_size, total), request)


@router.get("/{exam_id}")
def get_one(exam_id: str, request: Request, user=Depends(any_exam_user), db: Session = Depends(get_db)):
    return ok(exam_out(exam_service.get_exam_for_user(db, user, exam_id), user.role == Role.STUDENT.value), request)


@router.patch("/{exam_id}")
def update(exam_id: str, body: ExamUpdateIn, request: Request, user=Depends(manager), db: Session = Depends(get_db)):
    return ok(exam_out(exam_service.update_exam(db, user, exam_id, body.model_dump(exclude_unset=True))), request)


@router.delete("/{exam_id}")
def delete(exam_id: str, request: Request, user=Depends(manager), db: Session = Depends(get_db)):
    exam_service.delete_draft(db, user, exam_id)
    return ok({"deleted": True}, request)


@router.post("/{exam_id}/publish")
def publish(exam_id: str, request: Request, user=Depends(manager), db: Session = Depends(get_db)):
    return ok(exam_out(publishing_service.publish_exam(db, user, exam_id)), request)


@router.post("/{exam_id}/status")
def set_status(exam_id: str, body: StatusIn, request: Request, user=Depends(manager), db: Session = Depends(get_db)):
    return ok(exam_out(exam_service.transition_exam(db, user, exam_id, body.to)), request)


@router.get("/{exam_id}/questions")
def list_questions(exam_id: str, request: Request, user=Depends(manager), db: Session = Depends(get_db)):
    exam_service.get_exam_for_manage(db, user, exam_id)
    return ok([exam_question_out(r) for r in eqs.list_exam_questions(db, exam_id)], request)


@router.post("/{exam_id}/questions", status_code=201)
def attach(exam_id: str, body: AttachIn, request: Request, user=Depends(manager), db: Session = Depends(get_db)):
    eq = eqs.attach_question(db, user, exam_id, body.question_id, body.position, body.marks, body.required)
    return ok(exam_question_out(eq), request)


@router.put("/{exam_id}/questions/order")
def reorder(exam_id: str, body: OrderIn, request: Request, user=Depends(manager), db: Session = Depends(get_db)):
    return ok([exam_question_out(r) for r in eqs.reorder(db, user, exam_id, body.question_ids)], request)


@router.delete("/{exam_id}/questions/{question_id}")
def detach(exam_id: str, question_id: str, request: Request, user=Depends(manager), db: Session = Depends(get_db)):
    eqs.detach_question(db, user, exam_id, question_id)
    return ok({"detached": True}, request)
