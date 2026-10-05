from pydantic import EmailStr, Field
from app.schemas.common import CamelModel


class RegisterIn(CamelModel):
    email: EmailStr
    password: str
    full_name: str = Field(min_length=1, max_length=200)


class LoginIn(CamelModel):
    email: str
    password: str


class RefreshIn(CamelModel):
    refresh_token: str


class ResetRequestIn(CamelModel):
    email: str


class ResetConfirmIn(CamelModel):
    token: str
    new_password: str
