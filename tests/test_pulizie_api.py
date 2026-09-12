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


def _configura_roommate(admin_client, usernames):
    ids = [_crea_utente(admin_client, u) for u in usernames]
    admin_client.put("/api/pulizie/roommate", json={"user_ids": ids})
    return ids


def test_schedule_is_empty_without_roommates(admin_client):
    resp = admin_client.get("/api/pulizie/settimane")
    assert resp.status_code == 200
    assert resp.json() == []


def test_schedule_defaults_to_four_weeks(admin_client):
    _configura_roommate(admin_client, ["alice", "bob"])
    resp = admin_client.get("/api/pulizie/settimane")
    assert resp.status_code == 200
    assert len(resp.json()) == 4


def test_schedule_respects_settimane_query_param(admin_client):
    _configura_roommate(admin_client, ["alice", "bob"])
    resp = admin_client.get("/api/pulizie/settimane?settimane=2")
    assert len(resp.json()) == 2


def test_only_assigned_user_can_mark_complete(client, admin_client):
    ids = _configura_roommate(admin_client, ["alice", "bob"])
    settimane = admin_client.get("/api/pulizie/settimane").json()
    idx_corrente = settimane[0]["settimana_idx"]
    non_assegnato_username = "bob" if settimane[0]["assegnato_username"] == "alice" else "alice"
    client.post("/api/auth/login", json={"username": non_assegnato_username, "password": "x"})
    resp = client.post(f"/api/pulizie/settimane/{idx_corrente}/completa")
    assert resp.status_code == 403


def test_assigned_user_can_mark_complete_and_it_is_idempotent(client, admin_client):
    _configura_roommate(admin_client, ["alice", "bob"])
    settimane = admin_client.get("/api/pulizie/settimane").json()
    idx_corrente = settimane[0]["settimana_idx"]
    assegnato = settimane[0]["assegnato_username"]
    client.post("/api/auth/login", json={"username": assegnato, "password": "x"})
    resp1 = client.post(f"/api/pulizie/settimane/{idx_corrente}/completa")
    assert resp1.status_code == 200
    assert resp1.json()["completato"] is True
    primo_timestamp = resp1.json()["completato_il"]
    resp2 = client.post(f"/api/pulizie/settimane/{idx_corrente}/completa")
    assert resp2.status_code == 200
    assert resp2.json()["completato_il"] == primo_timestamp
