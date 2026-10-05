from tests.conftest import utc

BODY = {"title": "Midterm", "durationSeconds": 3600}


def test_instructor_creates_draft(client, make_user, auth):
    i = make_user("INSTRUCTOR")
    r = client.post("/exams", json=BODY, headers=auth(i))
    assert r.status_code == 201 and r.json()["data"]["status"] == "DRAFT"


def test_student_cannot_create(client, make_user, auth):
    assert client.post("/exams", json=BODY, headers=auth(make_user("STUDENT"))).status_code == 403


def test_validation_errors(client, make_user, auth):
    h = auth(make_user("INSTRUCTOR"))
    assert client.post("/exams", json={"title": "  ", "durationSeconds": 60}, headers=h).status_code == 422
    assert client.post("/exams", json={"title": "x", "durationSeconds": -5}, headers=h).status_code == 422
    r = client.post("/exams", json={**BODY, "startsAt": "2030-01-02T00:00:00Z", "endsAt": "2030-01-01T00:00:00Z"}, headers=h)
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_draft_editable_and_other_instructor_404(client, make_user, auth):
    a, b = make_user("INSTRUCTOR"), make_user("INSTRUCTOR")
    eid = client.post("/exams", json=BODY, headers=auth(a)).json()["data"]["id"]
    r = client.patch(f"/exams/{eid}", json={"durationSeconds": 120, "title": "New"}, headers=auth(a))
    assert r.json()["data"]["durationSeconds"] == 120
    assert client.patch(f"/exams/{eid}", json={"title": "hack"}, headers=auth(b)).status_code == 404
    assert client.get(f"/exams/{eid}", headers=auth(b)).status_code == 404


def test_published_duration_change_blocked(client, make_user, auth, pub_exam):
    i = make_user("INSTRUCTOR")
    exam = pub_exam(i)
    r = client.patch(f"/exams/{exam.id}", json={"durationSeconds": 10}, headers=auth(i))
    assert r.status_code == 409 and r.json()["error"]["code"] == "EXAM_NOT_EDITABLE"
    assert client.patch(f"/exams/{exam.id}", json={"title": "Renamed"}, headers=auth(i)).status_code == 200


def test_transitions(client, make_user, auth, pub_exam):
    i = make_user("INSTRUCTOR")
    exam = pub_exam(i)
    h = auth(i)
    assert client.post(f"/exams/{exam.id}/status", json={"to": "CLOSED"}, headers=h).status_code == 409
    assert client.post(f"/exams/{exam.id}/status", json={"to": "PUBLISHED"}, headers=h).status_code == 409
    for to in ("ACTIVE", "CLOSED", "ARCHIVED"):
        assert client.post(f"/exams/{exam.id}/status", json={"to": to}, headers=h).json()["data"]["status"] == to
    assert client.post(f"/exams/{exam.id}/status", json={"to": "ACTIVE"}, headers=h).json()["error"]["code"] == "INVALID_STATE_TRANSITION"


def test_student_sees_only_published_active(client, make_user, auth, mk_exam, pub_exam):
    i, s = make_user("INSTRUCTOR"), make_user("STUDENT")
    mk_exam(i, title="draft")
    live = pub_exam(i)
    closed = pub_exam(i)
    client.post(f"/exams/{closed.id}/status", json={"to": "ACTIVE"}, headers=auth(i))
    client.post(f"/exams/{closed.id}/status", json={"to": "CLOSED"}, headers=auth(i))
    items = client.get("/exams", headers=auth(s)).json()["data"]["items"]
    assert [e["id"] for e in items] == [live.id]
    assert "passMarks" not in items[0]
    assert client.get(f"/exams/{closed.id}", headers=auth(s)).status_code == 404


def test_pagination_and_delete_draft(client, make_user, auth, mk_exam, pub_exam):
    i = make_user("INSTRUCTOR")
    for k in range(3):
        mk_exam(i, title=f"e{k}")
    d = client.get("/exams?page=1&pageSize=2", headers=auth(i)).json()["data"]
    assert d["total"] == 3 and len(d["items"]) == 2
    pub = pub_exam(i)
    assert client.delete(f"/exams/{pub.id}", headers=auth(i)).status_code == 409
    draft_id = d["items"][0]["id"]
    assert client.delete(f"/exams/{draft_id}", headers=auth(i)).status_code == 200
    assert client.get(f"/exams?status=PUBLISHED", headers=auth(i)).json()["data"]["total"] == 1
