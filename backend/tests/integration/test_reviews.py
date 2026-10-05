from sqlalchemy import select
from app.models.attempt import Attempt
from app.models.review import ReviewDecision
from app.models.submission import Submission
from app.utils import clock


def ev(seq, etype="SCREENSHOT_ATTEMPT"):
    return {"eventType": etype, "source": "WEB_CLIENT", "occurredAt": clock.to_iso(clock.utc_now()), "clientSequence": seq, "metadata": {}}


def under_review(started, client, auth):
    i, s, exam, v = started(lock_on_high_risk=True)
    client.post(f"/attempts/{v['id']}/events", json={"events": [ev(k) for k in range(1, 5)]}, headers=auth(s))
    return i, s, exam, v["id"]


def D(client, auth, u, aid, decision="NO_ISSUE", reason="looked at timeline"):
    return client.post(f"/reviews/attempts/{aid}/decision", json={"decision": decision, "reason": reason}, headers=auth(u))


def test_assigned_reviewer_sees_unassigned_404(started, client, auth, make_user):
    i, s, exam, aid = under_review(started, client, auth)
    rv, rv2 = make_user("REVIEWER"), make_user("REVIEWER")
    assert client.get(f"/reviews/attempts/{aid}/timeline", headers=auth(rv)).status_code == 404
    r = client.post(f"/reviews/attempts/{aid}/assign", json={"reviewerId": rv.id}, headers=auth(i))
    assert r.status_code == 200
    client.post(f"/reviews/attempts/{aid}/assign", json={"reviewerId": rv.id}, headers=auth(i))  # idempotent
    t = client.get(f"/reviews/attempts/{aid}/timeline", headers=auth(rv)).json()["data"]
    assert t["riskScore"] == 60 and t["riskLevel"] == "HIGH_RISK" and t["reasons"] == ["4 × SCREENSHOT_ATTEMPT (+60)"]
    assert [e["eventType"] for e in t["events"]] == ["SCREENSHOT_ATTEMPT"] * 4 and t["attempt"]["status"] == "UNDER_REVIEW"
    assert set(t["events"][0]) >= {"occurredAt", "eventType", "source", "severity", "weight", "metadata"}
    assert client.get(f"/reviews/attempts/{aid}/timeline", headers=auth(rv2)).status_code == 404
    assert client.get("/notifications", headers=auth(rv)).json()["data"][0]["kind"] == "REVIEW_ASSIGNED"


def test_assign_requires_reviewer_role_and_ownership(started, client, auth, make_user):
    i, s, exam, aid = under_review(started, client, auth)
    other_i = make_user("INSTRUCTOR")
    assert client.post(f"/reviews/attempts/{aid}/assign", json={"reviewerId": make_user("REVIEWER").id}, headers=auth(other_i)).status_code == 404
    assert client.post(f"/reviews/attempts/{aid}/assign", json={"reviewerId": s.id}, headers=auth(i)).status_code == 422
    assert client.post(f"/reviews/attempts/{aid}/assign", json={"reviewerId": make_user("REVIEWER").id}, headers=auth(make_user("REVIEWER"))).status_code == 403


def test_no_issue_submits_with_admin_action(started, client, auth, db):
    i, s, exam, aid = under_review(started, client, auth)
    assert D(client, auth, i, aid, "NO_ISSUE").status_code == 201
    db.expire_all()
    a = db.get(Attempt, aid)
    assert a.status == "SUBMITTED" and a.needs_review is False
    assert db.scalar(select(Submission.reason).where(Submission.attempt_id == aid)) == "ADMIN_ACTION"


def test_policy_violation_terminates_and_clarification_keeps(started, client, auth, db):
    i, s, exam, aid = under_review(started, client, auth)
    D(client, auth, i, aid, "NEEDS_CLARIFICATION")
    db.expire_all()
    assert db.get(Attempt, aid).status == "UNDER_REVIEW"
    D(client, auth, i, aid, "POLICY_VIOLATION")
    db.expire_all()
    assert db.get(Attempt, aid).status == "TERMINATED"
    assert db.scalar(select(Submission.reason).where(Submission.attempt_id == aid)) == "POLICY_TERMINATION"


def test_invalid_flag_submits(started, client, auth, db):
    i, s, exam, aid = under_review(started, client, auth)
    D(client, auth, i, aid, "INVALID_FLAG")
    db.expire_all()
    assert db.get(Attempt, aid).status == "SUBMITTED"


def test_decision_validation_and_append_only(started, client, auth):
    i, s, exam, aid = under_review(started, client, auth)
    assert D(client, auth, i, aid, reason="no").status_code == 422
    assert D(client, auth, i, aid, "MAYBE").status_code == 422
    assert D(client, auth, s, aid).status_code == 403
    D(client, auth, i, aid, "NEEDS_CLARIFICATION")
    D(client, auth, i, aid, "NEEDS_CLARIFICATION", "second look needed")
    t = client.get(f"/reviews/attempts/{aid}/timeline", headers=auth(i)).json()["data"]
    assert len(t["decisions"]) == 2
    for method in ("put", "patch", "delete"):  # update/delete route hai hi nahi
        assert getattr(client, method)(f"/reviews/attempts/{aid}/decision", headers=auth(i)).status_code == 405


def test_decision_on_non_under_review_only_records(started, client, auth, db):
    i, s, exam, v = started()
    aid = v["id"]
    client.post(f"/attempts/{aid}/events", json={"events": [ev(k, "SCREENSHOT_ATTEMPT") for k in range(1, 4)]}, headers=auth(s))  # 45, no lock
    db.expire_all()
    assert db.get(Attempt, aid).needs_review is True and db.get(Attempt, aid).status == "ACTIVE"
    D(client, auth, i, aid, "POLICY_VIOLATION")
    db.expire_all()
    assert db.get(Attempt, aid).status == "ACTIVE"  # state change nahi
    D(client, auth, i, aid, "NO_ISSUE")
    db.expire_all()
    a = db.get(Attempt, aid)
    assert a.status == "ACTIVE" and a.needs_review is False


def test_appeal_new_record_student_cannot_see_timeline(started, client, auth, db):
    i, s, exam, aid = under_review(started, client, auth)
    D(client, auth, i, aid, "POLICY_VIOLATION")
    r = client.post(f"/reviews/attempts/{aid}/appeal", json={"reason": "I was disconnected"}, headers=auth(s))
    assert r.status_code == 201 and set(r.json()["data"]) == {"id", "isAppeal", "createdAt"}
    assert db.query(ReviewDecision).count() == 2
    assert db.scalar(select(ReviewDecision.is_appeal).where(ReviewDecision.is_appeal.is_(True))) is True
    assert client.get(f"/reviews/attempts/{aid}/timeline", headers=auth(s)).status_code == 403
    assert client.get("/notifications", headers=auth(i)).json()["data"][0]["kind"] in ("APPEAL_FILED", "REVIEW_DECISION")
    assert client.post(f"/reviews/attempts/{aid}/appeal", json={"reason": "I was disconnected"}, headers=auth(s)).status_code == 201


def test_appeal_blocked_while_active_and_for_others(started, client, auth, make_user):
    i, s, exam, v = started()
    assert client.post(f"/reviews/attempts/{v['id']}/appeal", json={"reason": "please check"}, headers=auth(s)).json()["error"]["code"] == "REVIEW_NOT_ALLOWED"
    assert client.post(f"/reviews/attempts/{v['id']}/appeal", json={"reason": "please check"}, headers=auth(make_user("STUDENT"))).status_code == 404


def test_queue_filters_scope_and_pagination(started, client, auth, make_user):
    i, s, exam, aid = under_review(started, client, auth)
    i2, s2, exam2, v2 = started()
    client.post(f"/attempts/{v2['id']}/events", json={"events": [ev(1, "WINDOW_BLUR")]}, headers=auth(s2))  # score 3 NORMAL
    rv = make_user("REVIEWER")
    q = client.get("/reviews/queue", headers=auth(i)).json()["data"]
    assert q["total"] == 1 and q["items"][0]["attemptId"] == aid
    assert set(q["items"][0]) == {"attemptId", "examTitle", "studentName", "status", "riskScore", "riskLevel", "needsReview", "lastEventAt"}
    assert client.get("/reviews/queue?riskLevel=HIGH_RISK", headers=auth(i)).json()["data"]["total"] == 1
    assert client.get("/reviews/queue?riskLevel=WARNING", headers=auth(i)).json()["data"]["total"] == 0
    assert client.get("/reviews/queue?status=UNDER_REVIEW", headers=auth(i)).json()["data"]["total"] == 1
    assert client.get(f"/reviews/queue?examId={exam.id}&pageSize=1", headers=auth(i)).json()["data"]["pageSize"] == 1
    assert client.get("/reviews/queue", headers=auth(rv)).json()["data"]["total"] == 0  # assigned nahi
    client.post(f"/reviews/attempts/{aid}/assign", json={"reviewerId": rv.id}, headers=auth(i))
    assert client.get("/reviews/queue", headers=auth(rv)).json()["data"]["total"] == 1
    admin = make_user("ADMIN")
    assert client.get("/reviews/queue", headers=auth(admin)).json()["data"]["total"] == 2
    assert client.get("/reviews/queue", headers=auth(s)).status_code == 403


def test_verify_chain_and_export_endpoints(started, client, auth, make_user):
    i, s, exam, aid = under_review(started, client, auth)
    assert client.get(f"/reviews/attempts/{aid}/verify-chain", headers=auth(i)).json()["data"] == {"valid": True, "brokenAt": None}
    ex = client.get(f"/reviews/attempts/{aid}/export", headers=auth(i)).json()["data"]
    assert ex["verification"]["valid"] and len(ex["events"]) == 4
    assert client.get(f"/reviews/attempts/{aid}/verify-chain", headers=auth(make_user("INSTRUCTOR"))).status_code == 404
