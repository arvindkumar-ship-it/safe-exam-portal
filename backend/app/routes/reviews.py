from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session
from app.dependencies import get_db
from app.errors import ok
from app.schemas.review import AppealIn, AssignIn, DecisionIn
from app.security.permissions import Role, require_roles
from app.services import review_service
from app.utils.pagination import PageParams, page_out

router = APIRouter(prefix="/reviews", tags=["reviews"])
staff = require_roles(Role.REVIEWER, Role.INSTRUCTOR, Role.ADMIN)
manager = require_roles(Role.INSTRUCTOR, Role.ADMIN)


@router.get("/queue")
def queue(request: Request, p: PageParams = Depends(), riskLevel: str | None = Query(None), status: str | None = Query(None),
          examId: str | None = Query(None), user=Depends(staff), db: Session = Depends(get_db)):
    items, total = review_service.queue(db, user, {"riskLevel": riskLevel, "status": status, "examId": examId}, p.page, p.page_size)
    return ok(page_out(items, p.page, p.page_size, total), request)


@router.get("/attempts/{attempt_id}/timeline")
def timeline(attempt_id: str, request: Request, user=Depends(staff), db: Session = Depends(get_db)):
    return ok(review_service.timeline(db, user, attempt_id), request)


@router.post("/attempts/{attempt_id}/assign")
def assign(attempt_id: str, body: AssignIn, request: Request, user=Depends(manager), db: Session = Depends(get_db)):
    return ok(review_service.assign(db, user, attempt_id, body.reviewer_id), request)


@router.post("/attempts/{attempt_id}/decision", status_code=201)
def decision(attempt_id: str, body: DecisionIn, request: Request, user=Depends(staff), db: Session = Depends(get_db)):
    return ok(review_service.record_decision(db, user, attempt_id, body.decision, body.reason), request)


@router.post("/attempts/{attempt_id}/appeal", status_code=201)
def appeal(attempt_id: str, body: AppealIn, request: Request, user=Depends(require_roles(Role.STUDENT)), db: Session = Depends(get_db)):
    return ok(review_service.file_appeal(db, user, attempt_id, body.reason), request)


@router.get("/attempts/{attempt_id}/verify-chain")
def verify_chain(attempt_id: str, request: Request, user=Depends(staff), db: Session = Depends(get_db)):
    return ok(review_service.verify(db, user, attempt_id), request)


@router.get("/attempts/{attempt_id}/export")
def export(attempt_id: str, request: Request, user=Depends(staff), db: Session = Depends(get_db)):
    return ok(review_service.export(db, user, attempt_id), request)
