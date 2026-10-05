from app.services import notification_service as ns


def test_own_only_and_mark_read(client, make_user, auth, db):
    a, b = make_user("STUDENT"), make_user("STUDENT")
    n = ns.notify(db, a.id, "REVIEW_DECISION", "t", "b")
    db.commit()
    assert client.get("/notifications", headers=auth(b)).json()["data"] == []
    assert client.post(f"/notifications/{n.id}/read", headers=auth(b)).status_code == 404
    r = client.post(f"/notifications/{n.id}/read", headers=auth(a)).json()["data"]
    assert r["isRead"] is True
    assert client.get("/notifications", headers=auth(a)).json()["data"][0]["isRead"] is True
