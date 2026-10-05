from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from app.database import get_db  # noqa: F401  (re-export)
from app.errors import AppError
from app.models.user import User
from app.security.session import is_revoked
from app.security.tokens import decode_token

_bearer = HTTPBearer(auto_error=False)


def get_token_claims(creds: HTTPAuthorizationCredentials | None = Depends(_bearer), db: Session = Depends(get_db)) -> dict:
    if creds is None:
        raise AppError("UNAUTHENTICATED", "Missing bearer token.")
    claims = decode_token(creds.credentials, "access")
    if is_revoked(db, claims["jti"]):
        raise AppError("TOKEN_REVOKED", "Token has been revoked.")
    return claims


def get_current_user(claims: dict = Depends(get_token_claims), db: Session = Depends(get_db)) -> User:
    user = db.get(User, claims["sub"])
    if user is None:
        raise AppError("UNAUTHENTICATED", "User not found.")
    if not user.is_active:
        raise AppError("ACCOUNT_INACTIVE", "Account is inactive.")
    return user
