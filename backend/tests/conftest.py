import os
os.environ["ENV"] = "test"
os.environ["JWT_SECRET"] = "test-secret-test-secret-test-secret-1"
os.environ.setdefault("TEST_DATABASE_URL", "postgresql+psycopg://safeexam:safeexam@localhost:5432/safeexam_test")
os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]
os.environ["ALLOWED_ORIGINS"] = "http://localhost:5173"

from datetime import datetime, timedelta, timezone
import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import SessionLocal, engine
from app.main import app
from app.models.user import User
from app.security.password import hash_password
from app.security.rate_limit import reset_all
from app.security.tokens import create_access_token
from app.utils import clock

PASSWORD = "Passw0rd!"
_HASH = hash_password(PASSWORD)


@pytest.fixture(scope="session", autouse=True)
def _migrate():
    with engine.begin() as c:
        c.execute(text("DROP SCHEMA public CASCADE"))
        c.execute(text("CREATE SCHEMA public"))
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "migrations"))
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def _clean():
    reset_all()
    with engine.begin() as c:
        tables = [r[0] for r in c.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'alembic_version'"))]
        if tables:
            c.execute(text("TRUNCATE " + ",".join(f'"{t}"' for t in tables) + " CASCADE"))
    yield


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def db():
    s = SessionLocal()
    yield s
    s.close()


@pytest.fixture
def make_user(db):
    def _make(role="STUDENT", email=None, active=True, name="Test User"):
        email = email or f"{role.lower()}{db.query(User).count()}@example.com"
        u = User(email=email, password_hash=_HASH, full_name=name, role=role, is_active=active)
        db.add(u)
        db.commit()
        return u
    return _make


@pytest.fixture
def auth():
    def _auth(user):
        token, _ = create_access_token(user)
        return {"Authorization": f"Bearer {token}"}
    return _auth


@pytest.fixture
def freeze(monkeypatch):
    def _freeze(dt: datetime):
        monkeypatch.setattr(clock, "utc_now", lambda: dt)
    return _freeze


def utc(**delta):
    return datetime.now(timezone.utc) + timedelta(**delta)


# ---------- builders (services ke through; API ka kaam nahi) ----------
@pytest.fixture
def mk_q(db):
    from app.services import question_service
    def _mk(user, qtype="MCQ_SINGLE", **kw):
        data = {"question_type": qtype, "prompt": "2+2?", "marks": 1, "negative_marks": 0, "explanation": "because"}
        if qtype == "MCQ_SINGLE":
            data.update(options=[{"id": "o1", "text": "3"}, {"id": "o2", "text": "4"}, {"id": "o3", "text": "5"}], correct_answer="o2")
        elif qtype == "MCQ_MULTIPLE":
            data.update(options=[{"id": "o1", "text": "a"}, {"id": "o2", "text": "b"}, {"id": "o3", "text": "c"}], correct_answer=["o1", "o3"])
        else:
            data.update(options=None, correct_answer=["four", "4"])
        data.update(kw)
        return question_service.create_question(db, user, data)
    return _mk


@pytest.fixture
def mk_exam(db):
    from app.services import exam_service
    def _mk(user, **kw):
        data = {"title": "Midterm", "description": None, "duration_seconds": 3600, "starts_at": None,
                "ends_at": utc(days=1), "show_result": False, "max_attempts": 1, "shuffle_questions": True,
                "shuffle_options": True, "pass_marks": None, "lock_on_high_risk": False, "monitoring_policy": {}}
        data.update(kw)
        return exam_service.create_exam(db, user, data)
    return _mk


@pytest.fixture
def pub_exam(db, mk_exam, mk_q):
    from app.services import exam_question_service as eqs, publishing_service
    def _pub(instructor, n=2, types=None, **kw):
        exam = mk_exam(instructor, **kw)
        for i in range(n):
            q = mk_q(instructor, (types[i] if types else "MCQ_SINGLE"))
            eqs.attach_question(db, instructor, exam.id, q.id)
        return publishing_service.publish_exam(db, instructor, exam.id)
    return _pub


@pytest.fixture
def started(client, make_user, auth, pub_exam):
    """Published exam + student ka started attempt. returns (instructor, student, exam, attempt_view)"""
    def _go(n=2, **exam_kw):
        i, s = make_user("INSTRUCTOR"), make_user("STUDENT")
        exam = pub_exam(i, n=n, **exam_kw)
        v = client.post("/attempts/start", json={"examId": exam.id}, headers=auth(s)).json()["data"]
        return i, s, exam, v
    return _go
