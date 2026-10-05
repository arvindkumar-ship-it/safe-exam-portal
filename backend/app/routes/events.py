from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from app.dependencies import get_db
from app.errors import ok
from app.schemas.event import EventsIn
from app.security.permissions import Role, require_roles
from app.services import event_service

router = APIRouter(prefix="/attempts", tags=["events"])


@router.post("/{attempt_id}/events")
def ingest(attempt_id: str, body: EventsIn, request: Request, user=Depends(require_roles(Role.STUDENT)),
           db: Session = Depends(get_db)):
    return ok(event_service.ingest_batch(db, user, attempt_id, body.events), request)
