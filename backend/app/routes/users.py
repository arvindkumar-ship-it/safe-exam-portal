from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from app.dependencies import get_current_user, get_db
from app.errors import AppError, ok
from app.schemas.user import ActiveIn, ProfileUpdateIn, UserCreateIn, user_out
from app.security.password import hash_password, validate_password_strength
from app.security.permissions import Role, require_roles
from app.services import user_service
from app.utils.pagination import PageParams, page_out

router = APIRouter(prefix="/users", tags=["users"])
admin_only = require_roles(Role.ADMIN)


@router.get("/me")
def me(request: Request, user=Depends(get_current_user)):
    return ok(user_out(user), request)


@router.patch("/me")
def update_me(body: ProfileUpdateIn, request: Request, user=Depends(get_current_user), db: Session = Depends(get_db)):
    return ok(user_out(user_service.update_profile(db, user, body.full_name)), request)


@router.post("", status_code=201)
def create(body: UserCreateIn, request: Request, _=Depends(admin_only), db: Session = Depends(get_db)):
    validate_password_strength(body.password)
    return ok(user_out(user_service.create_user(db, body.email, hash_password(body.password), body.full_name, body.role)), request)


@router.get("")
def list_all(request: Request, p: PageParams = Depends(), _=Depends(admin_only), db: Session = Depends(get_db)):
    rows, total = user_service.list_users(db, p.page, p.page_size)
    return ok(page_out([user_out(u) for u in rows], p.page, p.page_size, total), request)


@router.patch("/{user_id}/active")
def set_active(user_id: str, body: ActiveIn, request: Request, _=Depends(admin_only), db: Session = Depends(get_db)):
    return ok(user_out(user_service.set_active(db, user_id, body.is_active)), request)
