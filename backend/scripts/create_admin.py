"""Pehla ADMIN banao (register hamesha STUDENT banata hai). Run from backend/:
    python scripts/create_admin.py admin@example.com "Admin Name"       # password prompt
Baad me admin POST /users se instructor/reviewer accounts banata hai."""
import getpass, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app.database import session_scope
from app.models.user import User
from app.security.password import hash_password, validate_password_strength
from app.services import user_service


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__); return 2
    email, name = sys.argv[1], sys.argv[2]
    pw = os.environ.get("ADMIN_PASSWORD") or getpass.getpass("Password: ")
    validate_password_strength(pw)
    with session_scope() as db:
        if user_service.get_by_email(db, email):
            print("User already exists."); return 1
        user_service.create_user(db, email, hash_password(pw), name, "ADMIN")
    print(f"ADMIN {email} created.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
