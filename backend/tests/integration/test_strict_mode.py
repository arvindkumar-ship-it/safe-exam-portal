from app.services import exam_question_service as eqs, publishing_service
from app.utils import clock


def _started(client, auth, db, make_user, mk_q, mk_exam, policy):
    i, s = make_user("INSTRUCTOR"), make_user("STUDENT")
    q = mk_q(i, "MCQ_SINGLE", options=[{"id": "a", "text": "A"}, {"id": "b", "text": "B"}], correct_answer="a", marks=1)
    exam = mk_exam(i, monitoring_policy=policy)
    eqs.attach_question(db, i, exam.id, q.id)
    publishing_service.publish_exam(db, i, exam.id)
    from app.services import exam_service
    exam_service.transition_exam(db, i, exam.id, "ACTIVE")
    v = client.post("/attempts/start", json={"examId": exam.id}, headers=auth(s)).json()
    return s, v["data"]["id"]


def _event(seq, etype, meta=None):
    return {"source": "WEB_CLIENT", "clientSequence": seq, "eventType": etype,
            "occurredAt": clock.to_iso(clock.utc_now()), "metadata": meta or {}}


def _post(client, auth, s, a, events):
    return client.post(f"/attempts/{a}/events", headers=auth(s), json={"events": events})


def test_strict_mode_tab_switch_auto_submits(client, make_user, auth, db, mk_q, mk_exam):
    s, a = _started(client, auth, db, make_user, mk_q, mk_exam, {"autoSubmitOnViolation": True})
    r = _post(client, auth, s, a, [_event(1, "PAGE_HIDDEN"), _event(2, "WINDOW_BLUR")])
    d = r.json()["data"]
    assert r.status_code == 200 and d["accepted"] == 2 and d["attemptStatus"] == "AUTO_SUBMITTED"
    hb = client.post(f"/attempts/{a}/heartbeat", headers=auth(s))
    assert "AUTO_SUBMITTED" in hb.text or hb.status_code in (200, 409, 410)
    # terminal ke baad aur event aaye to dobara submit nahi, error nahi
    r2 = _post(client, auth, s, a, [_event(3, "FULLSCREEN_EXIT")])
    assert r2.json()["data"]["attemptStatus"] == "AUTO_SUBMITTED"


def test_strict_mode_fullscreen_exit_auto_submits(client, make_user, auth, db, mk_q, mk_exam):
    s, a = _started(client, auth, db, make_user, mk_q, mk_exam, {"autoSubmitOnViolation": True})
    assert _post(client, auth, s, a, [_event(1, "FULLSCREEN_EXIT")]).json()["data"]["attemptStatus"] == "AUTO_SUBMITTED"


def test_strict_mode_ignores_info_events_and_accessibility_mode(client, make_user, auth, db, mk_q, mk_exam):
    s, a = _started(client, auth, db, make_user, mk_q, mk_exam, {"autoSubmitOnViolation": True})
    r = _post(client, auth, s, a, [_event(1, "WINDOW_FOCUS"), _event(2, "PAGE_VISIBLE"),
                                   _event(3, "WINDOW_BLUR", {"accessibilityMode": True})])
    assert r.json()["data"]["attemptStatus"] == "ACTIVE"


def test_default_policy_never_auto_submits(client, make_user, auth, db, mk_q, mk_exam):
    s, a = _started(client, auth, db, make_user, mk_q, mk_exam, {})
    r = _post(client, auth, s, a, [_event(1, "PAGE_HIDDEN"), _event(2, "WINDOW_BLUR"), _event(3, "FULLSCREEN_EXIT")])
    assert r.json()["data"]["attemptStatus"] == "ACTIVE"
