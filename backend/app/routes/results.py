from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from app.dependencies import get_db
from app.errors import ok
from app.security.permissions import Role, require_roles
from app.services import result_service
from app.utils.pagination import PageParams, page_out

router = APIRouter(tags=["results"])
manager = require_roles(Role.INSTRUCTOR, Role.ADMIN)


@router.get("/attempts/{attempt_id}/result")
def get_result(attempt_id: str, request: Request, user=Depends(require_roles(Role.STUDENT, Role.INSTRUCTOR, Role.ADMIN)),
               db: Session = Depends(get_db)):
    return ok(result_service.get_result_for_user(db, user, attempt_id), request)


@router.get("/exams/{exam_id}/results")
def list_results(exam_id: str, request: Request, p: PageParams = Depends(), user=Depends(manager), db: Session = Depends(get_db)):
    rows = result_service.list_exam_results(db, user, exam_id)
    return ok(page_out(rows[p.offset:p.offset + p.page_size], p.page, p.page_size, len(rows)), request)


@router.post("/exams/{exam_id}/results/publish")
def publish(exam_id: str, request: Request, user=Depends(manager), db: Session = Depends(get_db)):
    return ok(result_service.publish_results(db, user, exam_id), request)


@router.post("/attempts/{attempt_id}/re-evaluate")
def re_evaluate(attempt_id: str, request: Request, user=Depends(manager), db: Session = Depends(get_db)):
    return ok(result_service.re_evaluate(db, user, attempt_id), request)
