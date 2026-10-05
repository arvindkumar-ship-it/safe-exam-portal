def test_duplicate_email_rejected(client, make_user, auth):
    admin = make_user("ADMIN")
    body = {"email": "x@example.com", "password": "Passw0rd!", "fullName": "X", "role": "STUDENT"}
    assert client.post("/users", json=body, headers=auth(admin)).status_code == 201
    r = client.post("/users", json={**body, "email": " X@Example.com "}, headers=auth(admin))
    assert r.status_code == 409 and r.json()["error"]["code"] == "EMAIL_ALREADY_EXISTS"


def test_password_hash_not_in_response(client, make_user, auth):
    s = make_user("STUDENT")
    r = client.get("/users/me", headers=auth(s))
    assert "passwordHash" not in r.text and "password_hash" not in r.text
    assert r.json()["data"]["email"] == s.email


def test_inactive_flag(client, make_user, auth):
    admin, s = make_user("ADMIN"), make_user("STUDENT")
    r = client.patch(f"/users/{s.id}/active", json={"isActive": False}, headers=auth(admin))
    assert r.json()["data"]["isActive"] is False
    assert client.get("/users/me", headers=auth(s)).json()["error"]["code"] == "ACCOUNT_INACTIVE"


def test_student_updates_own_profile(client, make_user, auth):
    s = make_user("STUDENT")
    r = client.patch("/users/me", json={"fullName": "New Name"}, headers=auth(s))
    assert r.json()["data"]["fullName"] == "New Name"


def test_list_paginated(client, make_user, auth):
    admin = make_user("ADMIN")
    for _ in range(4):
        make_user("STUDENT")
    d = client.get("/users?page=2&pageSize=2", headers=auth(admin)).json()["data"]
    assert d["total"] == 5 and d["page"] == 2 and len(d["items"]) == 2
