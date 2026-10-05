from datetime import timedelta
from sqlalchemy import select, text
from app.models.attempt import Attempt
from app.models.audit_record import AuditRecord
from app.models.security_event import SecurityEvent
from app.services import audit_service as au
from app.utils import clock


def _attempt(started):
    i, s, exam, v = started()
    return v["id"]


def _add(db, aid, n=3, meta=None):
    for k in range(1, n + 1):
        au.append_security_event(db, aid, "WINDOW_BLUR", "LOW", "WEB_CLIENT", clock.utc_now(), k, meta or {"k": k})
    db.commit()


def test_chain_index_and_verify(started, db):
    aid = _attempt(started)
    _add(db, aid)
    rows = db.scalars(select(SecurityEvent).where(SecurityEvent.attempt_id == aid).order_by(SecurityEvent.chain_index)).all()
    assert [r.chain_index for r in rows] == [1, 2, 3]
    assert rows[0].previous_hash == "0" * 64 and rows[1].previous_hash == rows[0].event_hash
    assert au.verify_chain(db, aid) == {"valid": True, "brokenAt": None}


def test_tamper_detected(started, db):
    aid = _attempt(started)
    _add(db, aid)
    db.execute(text("UPDATE security_events SET metadata = '{\"k\": 999}' WHERE attempt_id=:a AND chain_index=2"), {"a": aid})
    db.commit()
    assert au.verify_chain(db, aid) == {"valid": False, "brokenAt": 2}


def test_deleted_event_detected(started, db):
    aid = _attempt(started)
    _add(db, aid)
    db.execute(text("DELETE FROM security_events WHERE attempt_id=:a AND chain_index=2"), {"a": aid})
    db.commit()
    assert au.verify_chain(db, aid)["valid"] is False


def test_sensitive_keys_stripped(started, db):
    aid = _attempt(started)
    _add(db, aid, 1, {"action": "paste", "text": "SECRET CLIP", "password": "x", "nested": {"token": "t", "ok": 1}})
    ev = db.scalar(select(SecurityEvent).where(SecurityEvent.attempt_id == aid))
    assert ev.event_metadata == {"action": "paste", "nested": {"ok": 1}}


def test_append_audit_chain_and_export(started, db):
    aid = _attempt(started)
    _add(db, aid, 2)
    r1 = au.append_audit(db, "TEST_ONE", attempt_id=aid, details={"a": 1, "password": "p"})
    r2 = au.append_audit(db, "TEST_TWO", attempt_id=aid)
    db.commit()
    assert r2.previous_hash == r1.record_hash and r2.chain_index == r1.chain_index + 1 and "password" not in r1.details
    ex = au.export_attempt_audit(db, aid)
    assert ex["verification"]["valid"] is True and len(ex["events"]) == 2
    assert [a["action"] for a in ex["auditRecords"]] == ["TEST_ONE", "TEST_TWO"]


def test_login_failure_and_logout_audited(client, make_user, db):
    u = make_user()
    client.post("/auth/login", json={"email": u.email, "password": "wrongpass1"})
    tok = client.post("/auth/login", json={"email": u.email, "password": "Passw0rd!"}).json()["data"]["accessToken"]
    client.post("/auth/logout", headers={"Authorization": f"Bearer {tok}"})
    actions = [a.action for a in db.scalars(select(AuditRecord).order_by(AuditRecord.chain_index))]
    assert actions == ["LOGIN_FAILED", "LOGOUT"]
