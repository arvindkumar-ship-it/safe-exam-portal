import uuid
from datetime import timedelta
import jwt
from app.config import get_settings
from app.errors import AppError
from app.utils import clock


def _make(user, typ: str, delta: timedelta):
    now = clock.utc_now()
    exp = now + delta
    claims = {"sub": user.id, "role": user.role, "jti": uuid.uuid4().hex, "typ": typ,
              "iat": int(now.timestamp()), "exp": int(exp.timestamp())}
    return jwt.encode(claims, get_settings().JWT_SECRET, algorithm="HS256"), exp


def create_access_token(user):
    return _make(user, "access", timedelta(minutes=get_settings().JWT_ACCESS_MINUTES))


def create_refresh_token(user):
    return _make(user, "refresh", timedelta(days=get_settings().JWT_REFRESH_DAYS))


def create_reset_token(user):
    return _make(user, "reset", timedelta(minutes=15))


def decode_token(token: str, expected_type: str) -> dict:
    # exp hum khud clock.utc_now() se check karte hain (tests me clock patch ho sake)
    try:
        claims = jwt.decode(token, get_settings().JWT_SECRET, algorithms=["HS256"],
                            options={"verify_exp": False, "verify_iat": False, "verify_nbf": False})
    except jwt.PyJWTError:
        raise AppError("UNAUTHENTICATED", "Invalid token.")
    if claims.get("typ") != expected_type:
        raise AppError("UNAUTHENTICATED", "Wrong token type.")
    if claims.get("exp", 0) <= int(clock.utc_now().timestamp()):
        raise AppError("TOKEN_EXPIRED", "Token expired.")
    return claims
