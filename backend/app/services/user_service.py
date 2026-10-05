from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.errors import AppError
from app.models.user import User
from app.security.permissions import Role

ROLES = {r.value for r in Role}


def create_user(db: Session, email: str, password_hash: str, full_name: str, role: str) -> User:
    email = email.strip().lower()
    if role not in ROLES:
        raise AppError("VALIDATION_ERROR", "Unknown role.")
    if get_by_email(db, email):
        raise AppError("EMAIL_ALREADY_EXISTS", "Email already registered.")
    user = User(email=email, password_hash=password_hash, full_name=full_name.strip(), role=role)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:  # race: dusra request pehle insert kar gaya
        db.rollback()
        raise AppError("EMAIL_ALREADY_EXISTS", "Email already registered.")
    return user


def get_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email.strip().lower()))


def get_user(db: Session, user_id: str) -> User | None:
    return db.get(User, user_id)


def set_active(db: Session, user_id: str, is_active: bool) -> User:
    user = db.get(User, user_id)
    if not user:
        raise AppError("NOT_FOUND", "User not found.")
    user.is_active = is_active
    db.commit()
    return user


def update_profile(db: Session, user: User, full_name: str) -> User:
    user.full_name = full_name.strip()
    db.commit()
    return user


def list_users(db: Session, page: int, page_size: int):
    total = db.scalar(select(func.count()).select_from(User))
    rows = db.scalars(select(User).order_by(User.created_at, User.id).offset((page - 1) * page_size).limit(page_size)).all()
    return list(rows), total
