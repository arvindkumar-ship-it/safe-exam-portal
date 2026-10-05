from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from app.dependencies import get_current_user, get_db
from app.errors import ok
from app.schemas.notification import notification_out
from app.services import notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
def list_(request: Request, user=Depends(get_current_user), db: Session = Depends(get_db)):
    return ok([notification_out(n) for n in notification_service.list_for_user(db, user)], request)


@router.post("/{nid}/read")
def read(nid: str, request: Request, user=Depends(get_current_user), db: Session = Depends(get_db)):
    return ok(notification_out(notification_service.mark_read(db, user, nid)), request)
