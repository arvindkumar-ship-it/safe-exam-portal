"""Integration fixtures. Test DB: TEST_DATABASE_URL, warna DATABASE_URL ka naam + '_test' (auto-create). Dev data kabhi touch nahi hota."""
import itertools
import os

import pytest

os.environ.setdefault("ENV", "local")
os.environ.setdefault("JWT_SECRET", "change-me-local-only-min-32-chars-long")
_url = os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if _url:
    if not os.environ.get("TEST_DATABASE_URL"):
        _url = _url.rsplit("/", 1)[0] + "/" + _url.rsplit("/", 1)[1].split("?")[0] + "_test"
    os.environ["DATABASE_URL"] = _url
from urllib.parse import urlsplit, unquote

def _require_test_database(url):
    name = unquote(urlsplit(url).path.rsplit("/", 1)[-1])
    if not name.endswith("_test"):
        raise RuntimeError("Destructive test fixtures require a dedicated database ending in _test")

if os.environ.get("DATABASE_URL"):
    _require_test_database(os.environ["DATABASE_URL"])



def _ensure_db():
    import psycopg
    import psycopg.sql
    from psycopg.conninfo import conninfo_to_dict
    d = conninfo_to_dict(os.environ["DATABASE_URL"].replace("postgresql+psycopg://", "postgresql://"))
    name = d.pop("dbname")
    with psycopg.connect(**d, dbname="postgres", autocommit=True) as c:
        if not c.execute("SELECT 1 FROM pg_database WHERE datname=%s", (name,)).fetchone():
            c.execute(psycopg.sql.SQL("CREATE DATABASE {}").format(psycopg.sql.Identifier(name)))


@pytest.fixture(scope="session", autouse=True)
def _schema():
    if not os.environ.get("DATABASE_URL"):
        pytest.skip("DATABASE_URL not set")
    _ensure_db()
    import app.models  # noqa: F401  (saare tables register)
    from app.database import engine
    from app.models.base import Base
    Base.metadata.create_all(engine)
    yield
    engine.dispose()


@pytest.fixture(autouse=True)
def _clean(_schema):
    yield
    from sqlalchemy import text
    from app.database import engine
    from app.models.base import Base
    with engine.begin() as c:
        c.execute(text("TRUNCATE " + ",".join(f'"{t.name}"' for t in Base.metadata.sorted_tables) + " RESTART IDENTITY CASCADE"))


@pytest.fixture
def db():
    from app.database import SessionLocal
    s = SessionLocal()
    yield s
    s.rollback()
    s.close()


@pytest.fixture
def client(db):
    from fastapi.testclient import TestClient
    from app.dependencies import get_db
    from app.main import app
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def make_user(db):
    from app.security.password import hash_password
    from app.services import user_service
    n = itertools.count(1)
    return lambda role="STUDENT": user_service.create_user(db, f"u{next(n)}_{role.lower()}@test.local", hash_password("Passw0rd!x9"), f"Test {role}", role)


@pytest.fixture
def auth():
    from app.security.tokens import create_access_token
    return lambda user: {"Authorization": f"Bearer {create_access_token(user)[0]}"}


@pytest.fixture
def mk_q(db):
    from app.services import question_service
    def f(user, qtype="MCQ_SINGLE", options=None, correct_answer=None, coding=None, marks=1, prompt="Q"):
        return question_service.create_question(db, user, {"question_type": qtype, "prompt": prompt, "options": options,
                                                           "correct_answer": correct_answer, "coding": coding, "marks": marks})
    return f


@pytest.fixture
def mk_exam(db):
    from app.services import exam_service
    return lambda user, **kw: exam_service.create_exam(db, user, {"title": "Exam", "duration_seconds": 3600, **kw})
