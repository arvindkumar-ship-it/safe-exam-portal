import re
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError
from app.errors import AppError

_ph = PasswordHasher()


def hash_password(plain: str) -> str:
    return _ph.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, plain)
    except (VerifyMismatchError, InvalidHashError):
        return False


def validate_password_strength(plain: str) -> None:
    if len(plain) < 8 or not re.search(r"[A-Za-z]", plain) or not re.search(r"\d", plain):
        raise AppError("VALIDATION_ERROR", "Password must be at least 8 characters with a letter and a digit.")
