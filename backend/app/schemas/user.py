from pydantic import EmailStr, Field
from app.schemas.common import CamelModel
from app.utils.clock import to_iso


class UserCreateIn(CamelModel):
    email: EmailStr
    password: str
    full_name: str = Field(min_length=1, max_length=200)
    role: str


class ProfileUpdateIn(CamelModel):
    full_name: str = Field(min_length=1, max_length=200)


class ActiveIn(CamelModel):
    is_active: bool


def user_out(u) -> dict:
    # passwordHash kabhi response me nahi
    return {"id": u.id, "email": u.email, "fullName": u.full_name, "role": u.role,
            "isActive": u.is_active, "createdAt": to_iso(u.created_at)}
