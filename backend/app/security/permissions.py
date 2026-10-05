from enum import Enum
from fastapi import Depends
from app.errors import AppError


class Role(str, Enum):
    STUDENT = "STUDENT"
    INSTRUCTOR = "INSTRUCTOR"
    REVIEWER = "REVIEWER"
    ADMIN = "ADMIN"


def require_roles(*roles: Role):
    allowed = {r.value if isinstance(r, Role) else r for r in roles}
    from app.dependencies import get_current_user  # circular se bachne ke liye

    def dep(user=Depends(get_current_user)):
        if user.role not in allowed:
            raise AppError("FORBIDDEN", "You do not have access to this resource.")
        return user
    return dep
