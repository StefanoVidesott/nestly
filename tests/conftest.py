import sys

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def app(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    sys.modules.pop("main", None)
    import main
    yield main


@pytest.fixture()
def client(app):
    with TestClient(app.app) as c:
        yield c


@pytest.fixture()
def db(app):
    session = app.SessionLocal()
    yield session
    session.close()


@pytest.fixture()
def admin_client(client):
    resp = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
    assert resp.status_code == 200
    return client
