import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from app.config import load_settings
from app.main import create_app


def test_health_envelope(client):
    r = client.get("/health")
    assert r.status_code == 200
    j = r.json()
    assert j["data"]["status"] == "ok" and j["data"]["serverTime"].endswith("Z")
    assert j["error"] is None and j["requestId"].startswith("req_")


def test_missing_env_readable_error(monkeypatch):
    monkeypatch.delenv("DATABASE_URL")
    with pytest.raises(RuntimeError) as e:
        load_settings(_env_file=None)
    assert "DATABASE_URL" in str(e.value)


def test_cors(client):
    ok = client.get("/health", headers={"Origin": "http://localhost:5173"})
    bad = client.get("/health", headers={"Origin": "http://evil.example"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "access-control-allow-origin" not in bad.headers


def test_unhandled_exception_envelope():
    app = create_app()

    @app.get("/boom")
    def boom():
        raise ValueError("secret stack")
    r = TestClient(app, raise_server_exceptions=False).get("/boom")
    assert r.status_code == 500
    assert r.json()["error"]["code"] == "INTERNAL_ERROR" and "secret" not in r.text


def test_db_select_1(db):
    assert db.execute(text("SELECT 1")).scalar() == 1
