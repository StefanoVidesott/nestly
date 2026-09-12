def _crea_utente(admin_client, username, moduli=("pulizie",)):
    resp = admin_client.post("/api/admin/users", json={
        "username": username,
        "password": "x",
        "role": "user",
        "allowed_modules": list(moduli),
    })
    assert resp.status_code == 200
    return resp.json()["id"]


def test_roommate_list_starts_empty(admin_client):
    resp = admin_client.get("/api/pulizie/roommate")
    assert resp.status_code == 200
    assert resp.json() == []


def test_admin_sets_roommate_order(admin_client):
    alice_id = _crea_utente(admin_client, "alice")
    bob_id = _crea_utente(admin_client, "bob")
    resp = admin_client.put("/api/pulizie/roommate", json={"user_ids": [bob_id, alice_id]})
    assert resp.status_code == 200
    body = resp.json()
    assert [r["username"] for r in body] == ["bob", "alice"]
    assert [r["ordine"] for r in body] == [0, 1]


def test_non_admin_cannot_set_roommate_order(client, admin_client):
    alice_id = _crea_utente(admin_client, "alice")
    client.post("/api/auth/login", json={"username": "alice", "password": "x"})
    resp = client.put("/api/pulizie/roommate", json={"user_ids": [alice_id]})
    assert resp.status_code == 403


def test_unknown_user_in_roommate_list_is_rejected(admin_client):
    resp = admin_client.put("/api/pulizie/roommate", json={"user_ids": [999999]})
    assert resp.status_code == 400


def test_duplicate_user_in_roommate_list_is_rejected(admin_client):
    alice_id = _crea_utente(admin_client, "alice")
    resp = admin_client.put("/api/pulizie/roommate", json={"user_ids": [alice_id, alice_id]})
    assert resp.status_code == 400
