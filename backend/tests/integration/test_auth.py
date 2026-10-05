from datetime import timedelta
import app.services.auth_service as auth_service
from app.utils import clock

PW = "Passw0rd!"


def login(client, email, pw=PW):
    return client.post("/auth/login", json={"email": email, "password": pw})


def test_register_and_login(client):
    r = client.post("/auth/register", json={"email": "S@Example.com", "password": PW, "fullName": "S"})
    assert r.status_code == 201 and r.json()["data"]["role"] == "STUDENT"
    d = login(client, "s@example.com").json()["data"]
    assert d["tokenType"] == "bearer" and d["accessToken"] and d["refreshToken"] and d["user"]["email"] == "s@example.com"


def test_register_always_student_and_weak_password(client):
    r = client.post("/auth/register", json={"email": "a@example.com", "password": PW, "fullName": "A", "role": "ADMIN"})
    assert r.json()["data"]["role"] == "STUDENT"
    r = client.post("/auth/register", json={"email": "b@example.com", "password": "short", "fullName": "B"})
    assert r.status_code == 422


def test_wrong_password_generic(client, make_user):
    u = make_user()
    a = login(client, u.email, "wrongpass1")
    b = login(client, "nobody@example.com", "wrongpass1")
    assert a.status_code == b.status_code == 401
    assert a.json()["error"] == b.json()["error"]


def test_locked_after_5_fails(client, make_user):
    u = make_user()
    for _ in range(5):
        assert login(client, u.email, "wrongpass1").status_code == 401
    r = login(client, u.email, PW)
    assert r.status_code == 423 and r.json()["error"]["code"] == "ACCOUNT_LOCKED"


def test_expired_token(client, make_user, freeze):
    u = make_user()
    tok = login(client, u.email).json()["data"]["accessToken"]
    freeze(clock.utc_now() + timedelta(hours=2))
    r = client.get("/users/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.json()["error"]["code"] == "TOKEN_EXPIRED"


def test_revoked_after_logout(client, make_user):
    u = make_user()
    h = {"Authorization": "Bearer " + login(client, u.email).json()["data"]["accessToken"]}
    assert client.post("/auth/logout", json={}, headers=h).json()["data"]["loggedOut"] is True
    r = client.get("/users/me", headers=h)
    assert r.status_code == 401 and r.json()["error"]["code"] == "TOKEN_REVOKED"


def test_refresh_gives_new_pair(client, make_user):
    u = make_user()
    old = login(client, u.email).json()["data"]
    new = client.post("/auth/refresh", json={"refreshToken": old["refreshToken"]}).json()["data"]
    assert new["accessToken"] and new["refreshToken"] != old["refreshToken"]
    assert client.post("/auth/refresh", json={"refreshToken": old["refreshToken"]}).status_code == 401  # rotated
    assert client.post("/auth/refresh", json={"refreshToken": old["accessToken"]}).status_code == 401  # wrong type


def test_inactive_cannot_login(client, make_user):
    u = make_user(active=False)
    assert login(client, u.email).json()["error"]["code"] == "ACCOUNT_INACTIVE"


def test_rate_limit(client):
    codes = [login(client, "x@example.com", "wrongpass1").status_code for _ in range(11)]
    assert codes[:10] == [401] * 10 and codes[10] == 429


def test_password_reset_flow(client, make_user, monkeypatch):
    u = make_user()
    sent = []
    class Fake(auth_service.EmailSender):
        def send(self, to, subject, body): sent.append(body)
    monkeypatch.setattr(auth_service, "email_sender", Fake())
    assert client.post("/auth/password-reset/request", json={"email": "ghost@example.com"}).status_code == 202
    assert sent == []
    assert client.post("/auth/password-reset/request", json={"email": u.email}).status_code == 202
    token = sent[0].split(": ")[1]
    assert client.post("/auth/password-reset/confirm", json={"token": token, "newPassword": "NewPassw0rd"}).json()["data"]["reset"]
    assert login(client, u.email, "NewPassw0rd").status_code == 200
    assert client.post("/auth/password-reset/confirm", json={"token": token, "newPassword": "NewPassw0rd2"}).status_code == 401


def test_password_never_in_response_or_log(client, make_user, caplog):
    u = make_user()
    caplog.set_level("DEBUG")
    r = login(client, u.email, "wrongpass1")
    assert "wrongpass1" not in r.text and "wrongpass1" not in caplog.text
    r = login(client, u.email)
    assert PW not in r.text and PW not in caplog.text and "passwordHash" not in r.text
