from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from app.config import get_settings
from app.dependencies import get_db
from app.errors import AppError, ok
from app.schemas.code_submission import CodingTestsCreateIn
from app.security.permissions import Role, require_roles
from app.services import coding_test_service as cts

router = APIRouter(prefix="/questions/{qid}/tests", tags=["coding-tests"])
manager = require_roles(Role.INSTRUCTOR, Role.ADMIN)


def _limit_body(request: Request) -> None:
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > get_settings().TEST_UPLOAD_MAX_BYTES * 2 + 65536:
        raise AppError("VALIDATION_ERROR", "Upload too large.", 413)


@router.post("", status_code=201, dependencies=[Depends(_limit_body)])
def add(qid: str, body: CodingTestsCreateIn, request: Request, user=Depends(manager), db: Session = Depends(get_db)):
    return ok(cts.add_tests(db, user, qid, [t.model_dump() for t in body.tests]), request)


@router.get("")
def list_(qid: str, request: Request, user=Depends(manager), db: Session = Depends(get_db)):
    return ok(cts.list_tests(db, user, qid), request)


@router.get("/{tid}")
def get_one(qid: str, tid: str, request: Request, user=Depends(manager), db: Session = Depends(get_db)):
    return ok(cts.get_test(db, user, qid, tid), request)


@router.delete("/{tid}")
def delete(qid: str, tid: str, request: Request, user=Depends(manager), db: Session = Depends(get_db)):
    cts.delete_test(db, user, qid, tid)
    return ok({"deleted": True}, request)
