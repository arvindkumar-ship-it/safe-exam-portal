"""Product C (WPF native client) -> Product A contract.
C ka wire format yahan freeze hai: source NATIVE_CLIENT, ms-precision 'Z' timestamps, metadata.deviceId,
alag clientSequence counter. Agar C ya A badle aur ye toot jaye => integration break."""
from app.utils import clock

NATIVE_TYPES = [
    "NATIVE_CLIENT_STARTED", "UNAUTHORIZED_PROCESS", "PROCESS_MONITOR_UNAVAILABLE", "MULTIPLE_MONITOR",
    "DISPLAY_CONFIGURATION_CHANGED", "WINDOW_BLUR", "WINDOW_FOCUS", "CLIPBOARD_ATTEMPT",
    "PRINT_ATTEMPT", "SCREENSHOT_ATTEMPT", "NATIVE_CRASH_RECOVERED",
]


def native_ev(seq, etype, meta=None):
    # C format: 2026-10-04T18:40:00.000Z
    at = clock.utc_now().strftime("%Y-%m-%dT%H:%M:%S.") + "000Z"
    return {"eventType": etype, "source": "NATIVE_CLIENT", "occurredAt": at, "clientSequence": seq,
            "metadata": {"deviceId": "abcd1234efgh5678", **(meta or {})}}


def test_all_native_event_types_accepted(started, client, auth):
    i, s, exam, v = started()
    evs = [native_ev(n + 1, t, {"processName": "teamviewer"} if t == "UNAUTHORIZED_PROCESS" else None)
           for n, t in enumerate(NATIVE_TYPES)]
    d = client.post(f"/attempts/{v['id']}/events", json={"events": evs}, headers=auth(s)).json()["data"]
    assert d["source"] == "NATIVE_CLIENT" and d["accepted"] == len(NATIVE_TYPES) and d["rejected"] == []
    assert d["acknowledgedUpTo"] == len(NATIVE_TYPES)


def test_native_and_web_sequences_are_independent(started, client, auth):
    i, s, exam, v = started()
    web = {"eventType": "WINDOW_BLUR", "source": "WEB_CLIENT", "occurredAt": clock.to_iso(clock.utc_now()),
           "clientSequence": 1, "metadata": {}}
    assert client.post(f"/attempts/{v['id']}/events", json={"events": [web]}, headers=auth(s)).json()["data"]["acknowledgedUpTo"] == 1
    d = client.post(f"/attempts/{v['id']}/events", json={"events": [native_ev(1, "NATIVE_CLIENT_STARTED")]}, headers=auth(s)).json()["data"]
    assert d["accepted"] == 1 and d["acknowledgedUpTo"] == 1


def test_native_duplicate_batch_is_safe(started, client, auth):
    i, s, exam, v = started()
    b = {"events": [native_ev(1, "WINDOW_BLUR"), native_ev(2, "WINDOW_FOCUS")]}
    client.post(f"/attempts/{v['id']}/events", json=b, headers=auth(s))
    d = client.post(f"/attempts/{v['id']}/events", json=b, headers=auth(s)).json()["data"]
    assert d["duplicates"] == 2 and d["accepted"] == 0 and d["acknowledgedUpTo"] == 2


def test_accessibility_mode_native_event_has_zero_weight(started, client, auth, db):
    from app.models.attempt import Attempt
    i, s, exam, v = started()
    client.post(f"/attempts/{v['id']}/events", json={"events": [
        native_ev(1, "UNAUTHORIZED_PROCESS", {"processName": "nvda", "accessibilityMode": True})]}, headers=auth(s))
    assert db.get(Attempt, v["id"]).risk_score == 0


def test_native_process_event_is_weighted(started, client, auth, db):
    from app.models.attempt import Attempt
    i, s, exam, v = started()
    client.post(f"/attempts/{v['id']}/events", json={"events": [
        native_ev(1, "UNAUTHORIZED_PROCESS", {"processName": "teamviewer"})]}, headers=auth(s))
    assert db.get(Attempt, v["id"]).risk_score == 30


def test_heartbeat_shape_c_expects(started, client, auth):
    i, s, exam, v = started()
    d = client.post(f"/attempts/{v['id']}/heartbeat", headers=auth(s)).json()["data"]
    assert set(d) >= {"serverTime", "expiresAt", "attemptStatus"} and d["attemptStatus"] == "ACTIVE"


def test_native_client_cannot_send_server_source(started, client, auth):
    i, s, exam, v = started()
    e = native_ev(1, "WINDOW_BLUR"); e["source"] = "SERVER"
    r = client.post(f"/attempts/{v['id']}/events", json={"events": [e]}, headers=auth(s))
    assert r.status_code >= 400 or r.json()["data"]["rejected"]
