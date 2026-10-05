from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from app.dependencies import get_current_user, get_db, get_token_claims
from app.errors import ok
from app.schemas.auth import LoginIn, RefreshIn, RegisterIn, ResetConfirmIn, ResetRequestIn
from app.schemas.user import user_out
from app.security.rate_limit import RateLimiter, rate_limit
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])
login_limiter = RateLimiter(10, 60)  # 10/min per IP+email


@router.post("/register", status_code=201)
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    return ok(user_out(auth_service.register(db, body.email, body.password, body.full_name)), request)


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    login_limiter.hit(f"{request.client.host if request.client else 'x'}:{body.email.strip().lower()}")
    return ok(auth_service.login(db, body.email, body.password), request)


@router.post("/refresh", dependencies=[Depends(rate_limit("refresh", 30, 60))])
def refresh(body: RefreshIn, request: Request, db: Session = Depends(get_db)):
    return ok(auth_service.refresh(db, body.refresh_token), request)


@router.post("/logout")
def logout(request: Request, claims: dict = Depends(get_token_claims), db: Session = Depends(get_db)):
    return ok(auth_service.logout(db, claims), request)


@router.post("/password-reset/request", status_code=202, dependencies=[Depends(rate_limit("reset", 10, 60))])
def reset_request(body: ResetRequestIn, request: Request, db: Session = Depends(get_db)):
    return ok(auth_service.request_password_reset(db, body.email), request)


@router.post("/password-reset/confirm")
def reset_confirm(body: ResetConfirmIn, request: Request, db: Session = Depends(get_db)):
    return ok(auth_service.confirm_password_reset(db, body.token, body.new_password), request)
