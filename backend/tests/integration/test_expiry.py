from datetime import timedelta
from app.models.attempt import Attempt
from app.services import time_service


def test_heartbeat_basic_and_ignores_client_time(started, client, auth):
    i, s, exam, v = started()
    r = client.post(f"/attempts/{v['id']}/heartbeat", json={"serverTime": "1999-01-01T00:00:00Z"},
                    headers={**auth(s), "Date": "Mon, 01 Jan 1990 00:00:00 GMT", "X-Client-Time": "1990"})
    d = r.json()["data"]
    assert d["serverTime"].endswith("Z") and d["serverTime"] > "2020" and d["attemptStatus"] == "ACTIVE"
    assert d["expiresAt"] == v["expiresAt"]


def test_heartbeat_after_expiry_auto_submits(started, client, auth, freeze, db):
    i, s, exam, v = started(duration_seconds=120)
    a = db.get(Attempt, v["id"])
    freeze(a.expires_at - timedelta(seconds=1))
    assert client.post(f"/attempts/{a.id}/heartbeat", headers=auth(s)).json()["data"]["attemptStatus"] == "ACTIVE"
    freeze(a.expires_at)  # exact boundary
    assert client.post(f"/attempts/{a.id}/heartbeat", headers=auth(s)).json()["data"]["attemptStatus"] == "AUTO_SUBMITTED"


def test_expired_attempt_answer_blocked(started, client, auth, freeze, db):
    i, s, exam, v = started(duration_seconds=120)
    a = db.get(Attempt, v["id"])
    freeze(a.expires_at + timedelta(seconds=1))
    r = client.put(f"/attempts/{a.id}/answers/{v['questions'][0]['id']}", json={"answerValue": "o1", "version": 0}, headers=auth(s))
    assert r.status_code == 409 and r.json()["error"]["code"] == "ATTEMPT_EXPIRED"
    db.expire_all()
    assert db.get(Attempt, a.id).status == "AUTO_SUBMITTED"


def test_sweep_auto_submits(started, client, auth, freeze, db):
    i, s, exam, v = started(duration_seconds=120)
    a = db.get(Attempt, v["id"])
    assert time_service.auto_submit_expired(db) == 0
    freeze(a.expires_at + timedelta(seconds=2))
    assert time_service.auto_submit_expired(db) == 1
    assert time_service.auto_submit_expired(db) == 0
    db.expire_all()
    assert db.get(Attempt, a.id).status == "AUTO_SUBMITTED"
