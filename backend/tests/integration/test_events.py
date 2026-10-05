from datetime import timedelta
from sqlalchemy import select
from app.models.attempt import Attempt
from app.models.security_event import SecurityEvent
from app.services import audit_service as au, risk_service
from app.utils import clock


def ev(seq, etype="WINDOW_BLUR", source="WEB_CLIENT", **kw):
    d = {"eventType": etype, "source": source, "occurredAt": clock.to_iso(clock.utc_now()), "clientSequence": seq, "metadata": {}}
    d.update(kw)
    return d


def post(client, auth, s, aid, events):
    return client.post(f"/attempts/{aid}/events", json={"events": events}, headers=auth(s))


def test_valid_accepted_and_ack(started, client, auth, db):
    i, s, exam, v = started()
    d = post(client, auth, s, v["id"], [ev(1), ev(2, "FULLSCREEN_EXIT")]).json()["data"]
    assert d == {"source": "WEB_CLIENT", "acknowledgedUpTo": 2, "accepted": 2, "duplicates": 0, "rejected": []}
    a = db.get(Attempt, v["id"])
    assert a.risk_score == 13 and au.verify_chain(db, v["id"])["valid"]


def test_unknown_type_and_metadata_and_timestamp_rejected(started, client, auth):
    i, s, exam, v = started()
    big = ev(3, metadata={"x": "y" * 3000})
    future = ev(4, occurredAt=clock.to_iso(clock.utc_now() + timedelta(hours=1)))
    ancient = ev(5, occurredAt="2001-01-01T00:00:00Z")
    garbage = ev(6, occurredAt="not-a-date")
    d = post(client, auth, s, v["id"], [ev(1), ev(2, "TELEPORT"), big, future, ancient, garbage]).json()["data"]
    codes = {r["clientSequence"]: r["code"] for r in d["rejected"]}
    assert d["accepted"] == 1 and codes == {2: "EVENT_TYPE_UNKNOWN", 3: "EVENT_METADATA_TOO_LARGE", 4: "EVENT_TIMESTAMP_INVALID",
                                            5: "EVENT_TIMESTAMP_INVALID", 6: "EVENT_TIMESTAMP_INVALID"}
    assert d["acknowledgedUpTo"] == 1


def test_client_severity_ignored(started, client, auth, db):
    i, s, exam, v = started()
    post(client, auth, s, v["id"], [ev(1, "SCREENSHOT_ATTEMPT", severity="INFO")])
    assert db.scalar(select(SecurityEvent.severity)) == "HIGH"


def test_duplicates_counted_not_error(started, client, auth, db):
    i, s, exam, v = started()
    post(client, auth, s, v["id"], [ev(1), ev(2)])
    d = post(client, auth, s, v["id"], [ev(2), ev(3), ev(3)]).json()["data"]
    assert (d["accepted"], d["duplicates"], d["acknowledgedUpTo"]) == (1, 2, 3)
    assert db.query(SecurityEvent).count() == 3


def test_wrong_owner_404_and_mixed_source(started, client, auth, make_user):
    i, s, exam, v = started()
    assert post(client, auth, make_user("STUDENT"), v["id"], [ev(1)]).status_code == 404
    r = post(client, auth, s, v["id"], [ev(1), ev(2, source="NATIVE_CLIENT")])
    assert r.status_code == 422 and r.json()["error"]["code"] == "EVENT_MIXED_SOURCE"
    assert post(client, auth, s, v["id"], [ev(1, source="SERVER")]).json()["error"]["code"] == "EVENT_MIXED_SOURCE"


def test_contiguous_ack_with_gap_and_per_source(started, client, auth):
    i, s, exam, v = started()
    d = post(client, auth, s, v["id"], [ev(1), ev(2), ev(4)]).json()["data"]
    assert d["acknowledgedUpTo"] == 2
    d = post(client, auth, s, v["id"], [ev(3)]).json()["data"]
    assert d["acknowledgedUpTo"] == 4
    n = post(client, auth, s, v["id"], [ev(1, "NATIVE_CLIENT_STARTED", source="NATIVE_CLIENT")]).json()["data"]
    assert n["source"] == "NATIVE_CLIENT" and n["acknowledgedUpTo"] == 1


def test_batch_limit(started, client, auth):
    i, s, exam, v = started()
    assert post(client, auth, s, v["id"], [ev(k) for k in range(1, 102)]).status_code == 422
    assert post(client, auth, s, v["id"], []).status_code == 422


def test_terminal_attempt_grace_window(started, client, auth, freeze, db):
    i, s, exam, v = started()
    client.post(f"/attempts/{v['id']}/submit", headers=auth(s))
    assert post(client, auth, s, v["id"], [ev(1)]).json()["data"]["accepted"] == 1  # 5 min ke andar
    a = db.get(Attempt, v["id"])
    freeze(a.submitted_at + timedelta(minutes=6))
    r = post(client, auth, s, v["id"], [ev(2, occurredAt=clock.to_iso(clock.utc_now()))])
    assert r.status_code == 409 and r.json()["error"]["code"] == "ATTEMPT_NOT_ACTIVE"


def test_risk_flags_and_explain(started, client, auth, db):
    i, s, exam, v = started()
    post(client, auth, s, v["id"], [ev(1, "FULLSCREEN_EXIT"), ev(2, "FULLSCREEN_EXIT"), ev(3, "FULLSCREEN_EXIT"),
                                   ev(4, "NETWORK_DISCONNECTED"), ev(5, "PAGE_HIDDEN"), ev(6, "FULLSCREEN_EXIT", metadata={"accessibilityMode": True})])
    a = db.get(Attempt, v["id"])
    assert a.risk_score == 35 and a.needs_review is False and a.status == "ACTIVE"
    assert risk_service.explain(db, a.id) == ["3 × FULLSCREEN_EXIT (+30)", "1 × PAGE_HIDDEN (+5)"]
    post(client, auth, s, v["id"], [ev(7, "COPY_SHORTCUT")])
    db.expire_all()
    assert db.get(Attempt, v["id"]).needs_review is True  # 40


def test_lock_only_when_exam_flag_on(started, client, auth, db):
    heavy = [ev(k, "SCREENSHOT_ATTEMPT") for k in range(1, 5)]  # 4*15 = 60 -> HIGH_RISK
    i, s, exam, v = started(lock_on_high_risk=False)
    post(client, auth, s, v["id"], heavy)
    assert db.get(Attempt, v["id"]).status == "ACTIVE"           # auto-terminate/lock kabhi nahi
    i2, s2, exam2, v2 = started(lock_on_high_risk=True)
    post(client, auth, s2, v2["id"], [heavy[0]])
    assert db.get(Attempt, v2["id"]).status == "ACTIVE"          # single event se lock nahi
    post(client, auth, s2, v2["id"], [ev(k, "SCREENSHOT_ATTEMPT") for k in range(2, 5)])
    db.expire_all()
    assert db.get(Attempt, v2["id"]).status == "UNDER_REVIEW"
    note = client.get("/notifications", headers=auth(i2)).json()["data"]
    assert note[0]["kind"] == "ATTEMPT_UNDER_REVIEW"
    # UNDER_REVIEW me answer save blocked
    r = client.put(f"/attempts/{v2['id']}/answers/{v2['questions'][0]['id']}", json={"answerValue": "o1", "version": 0}, headers=auth(s2))
    assert r.json()["error"]["code"] == "ATTEMPT_NOT_ACTIVE"


def test_student_response_hides_risk(started, client, auth):
    i, s, exam, v = started()
    post(client, auth, s, v["id"], [ev(1, "SCREENSHOT_ATTEMPT")])
    assert "riskScore" not in client.get(f"/attempts/{v['id']}", headers=auth(s)).text
