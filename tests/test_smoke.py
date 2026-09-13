def test_unauthenticated_me_is_401(client):
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401


def test_admin_login_works(admin_client):
    resp = admin_client.get("/api/auth/me")
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"


def test_each_test_gets_an_isolated_database(app):
    assert app.DATABASE_URL != f"sqlite:///{app.DATA_DIR}/erasmus.db"
