import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from app.database import session_scope
from app.models.base import new_id
from app.models.user import User
from app.utils import clock


def test_migration_created_tables(db):
    assert db.execute(text("SELECT to_regclass('public.users')")).scalar() is not None


def test_rollback_undoes_insert(db):
    db.execute(text("CREATE TEMP TABLE t(id int)"))
    db.execute(text("INSERT INTO t VALUES (1)"))
    db.rollback()
    with pytest.raises(Exception):
        db.execute(text("SELECT * FROM t"))
    db.rollback()


def test_session_scope_commit_and_rollback():
    with session_scope() as s:
        s.add(User(email="a@x.com", password_hash="h", full_name="A", role="STUDENT"))
    with pytest.raises(RuntimeError):
        with session_scope() as s:
            s.add(User(email="b@x.com", password_hash="h", full_name="B", role="STUDENT"))
            s.flush()
            raise RuntimeError("x")
    with session_scope() as s:
        assert [u.email for u in s.query(User).all()] == ["a@x.com"]


def test_unique_violation(db):
    db.add(User(email="a@x.com", password_hash="h", full_name="A", role="STUDENT"))
    db.commit()
    db.add(User(email="a@x.com", password_hash="h", full_name="A", role="STUDENT"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_fk_violation(db):
    db.execute(text("CREATE TEMP TABLE parent(id int PRIMARY KEY)"))
    db.execute(text("CREATE TEMP TABLE child(pid int REFERENCES parent(id))"))
    with pytest.raises(IntegrityError):
        db.execute(text("INSERT INTO child VALUES (99)"))
    db.rollback()


def test_utc_now_tzaware():
    assert clock.utc_now().tzinfo is not None
    assert len(new_id()) == 36
