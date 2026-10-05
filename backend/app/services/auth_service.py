import logging
from datetime import timedelta
from sqlalchemy.orm import Session
from app.config import get_settings
from app.errors import AppError
from app.schemas.user import user_out
from app.security.password import hash_password, validate_password_strength, verify_password
from app.security.session import is_revoked, revoke_token
from app.security.tokens import (create_access_token, create_refresh_token, create_reset_token, decode_token)
from app.services import audit_service, user_service
from app.utils import clock
from app.utils.clock import to_iso

log = logging.getLogger("safeexam.auth")
_DUMMY_HASH = hash_password("dummy-password-1")  # timing barabar rakhne ke liye


class EmailSender:
    def send(self, to: str, subject: str, body: str) -> None:
        raise NotImplementedError


class ConsoleEmailSender(EmailSender):
    def send(self, to, subject, body):
        # token sirf local env me print hota hai
        if get_settings().ENV == "local":
            print(f"[email to {to}] {subject}: {body}")


email_sender: EmailSender = ConsoleEmailSender()


def _issue_pair(user) -> dict:
    access, exp = create_access_token(user)
    refresh, _ = create_refresh_token(user)
    return {"accessToken": access, "refreshToken": refresh, "tokenType": "bearer",
            "expiresAt": to_iso(exp), "user": user_out(user)}


def register(db: Session, email: str, password: str, full_name: str):
    validate_password_strength(password)
    return user_service.create_user(db, email, hash_password(password), full_name, "STUDENT")  # hamesha STUDENT


def login(db: Session, email: str, password: str) -> dict:
    s = get_settings()
    user = user_service.get_by_email(db, email)
    if user is None:
        verify_password(password, _DUMMY_HASH)
        log.info("login_failed unknown_email")
        audit_service.append_audit(db, "LOGIN_FAILED", details={"reason": "unknown_email"})
        db.commit()
        raise AppError("INVALID_CREDENTIALS", "Invalid email or password.")
    now = clock.utc_now()
    if user.locked_until and user.locked_until > now:
        raise AppError("ACCOUNT_LOCKED", "Account temporarily locked. Try again later.")
    if not verify_password(password, user.password_hash):
        user.failed_login_count += 1
        if user.failed_login_count >= s.LOGIN_MAX_FAILS:
            user.locked_until = now + timedelta(minutes=s.LOGIN_LOCK_MINUTES)
            user.failed_login_count = 0
        audit_service.append_audit(db, "LOGIN_FAILED", actor_id=user.id, details={"locked": user.locked_until is not None})
        db.commit()
        log.info("login_failed user=%s", user.id)
        raise AppError("INVALID_CREDENTIALS", "Invalid email or password.")
    if not user.is_active:
        raise AppError("ACCOUNT_INACTIVE", "Account is inactive.")
    user.failed_login_count, user.locked_until = 0, None
    db.commit()
    return _issue_pair(user)


def refresh(db: Session, refresh_token: str) -> dict:
    claims = decode_token(refresh_token, "refresh")
    if is_revoked(db, claims["jti"]):
        raise AppError("TOKEN_REVOKED", "Token has been revoked.")
    user = user_service.get_user(db, claims["sub"])
    if user is None:
        raise AppError("UNAUTHENTICATED", "User not found.")
    if not user.is_active:
        raise AppError("ACCOUNT_INACTIVE", "Account is inactive.")
    revoke_token(db, claims["jti"], clock.utc_now() + timedelta(days=get_settings().JWT_REFRESH_DAYS))  # rotation
    return _issue_pair(user)


def logout(db: Session, claims: dict) -> dict:
    revoke_token(db, claims["jti"], clock.utc_now() + timedelta(minutes=get_settings().JWT_ACCESS_MINUTES))
    audit_service.append_audit(db, "LOGOUT", actor_id=claims["sub"])
    db.commit()
    log.info("logout user=%s", claims["sub"])
    return {"loggedOut": True}


def request_password_reset(db: Session, email: str) -> dict:
    user = user_service.get_by_email(db, email)
    if user and user.is_active:
        token, _ = create_reset_token(user)
        email_sender.send(user.email, "Password reset", f"Reset token (15 min): {token}")
    return {"accepted": True}  # hamesha same response


def confirm_password_reset(db: Session, token: str, new_password: str) -> dict:
    claims = decode_token(token, "reset")
    if is_revoked(db, claims["jti"]):
        raise AppError("TOKEN_REVOKED", "Token has been used.")
    validate_password_strength(new_password)
    user = user_service.get_user(db, claims["sub"])
    if user is None:
        raise AppError("UNAUTHENTICATED", "User not found.")
    user.password_hash = hash_password(new_password)
    user.failed_login_count, user.locked_until = 0, None
    db.commit()
    revoke_token(db, claims["jti"], clock.utc_now() + timedelta(minutes=15))
    return {"reset": True}
