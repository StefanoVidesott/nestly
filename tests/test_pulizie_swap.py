def _crea_utente(admin_client, username, moduli=("pulizie",)):
    resp = admin_client.post("/api/admin/users", json={
        "username": username,
        "password": "x",
        "role": "user",
        "allowed_modules": list(moduli),
    })
    assert resp.status_code == 200
    return resp.json()["id"]


def _configura_roommate(admin_client, usernames):
    ids = [_crea_utente(admin_client, u) for u in usernames]
    admin_client.put("/api/pulizie/roommate", json={"user_ids": ids})
    return ids


def _turno_corrente(admin_client):
    settimane = admin_client.get("/api/pulizie/settimane").json()
    return settimane[0]


def _login(client, username):
    resp = client.post("/api/auth/login", json={"username": username, "password": "x"})
    assert resp.status_code == 200


def test_assigned_user_can_request_a_swap(client, admin_client):
    _configura_roommate(admin_client, ["alice", "bob"])
    corrente = _turno_corrente(admin_client)
    _login(client, corrente["assegnato_username"])
    altro = "bob" if corrente["assegnato_username"] == "alice" else "alice"
    resp = client.post("/api/pulizie/swap", json={
        "settimana_idx": corrente["settimana_idx"],
        "target_id": [r for r in admin_client.get("/api/pulizie/roommate").json() if r["username"] == altro][0]["user_id"],
    })
    assert resp.status_code == 200
    assert resp.json()["stato"] == "in_attesa"
    assert resp.json()["target_username"] == altro


def test_non_assigned_user_cannot_request_a_swap(client, admin_client):
    _configura_roommate(admin_client, ["alice", "bob"])
    corrente = _turno_corrente(admin_client)
    non_assegnato = "bob" if corrente["assegnato_username"] == "alice" else "alice"
    _login(client, non_assegnato)
    roommate = admin_client.get("/api/pulizie/roommate").json()
    target_id = [r for r in roommate if r["username"] == corrente["assegnato_username"]][0]["user_id"]
    resp = client.post("/api/pulizie/swap", json={"settimana_idx": corrente["settimana_idx"], "target_id": target_id})
    assert resp.status_code == 403


def test_cannot_request_swap_with_self(client, admin_client):
    _configura_roommate(admin_client, ["alice", "bob"])
    corrente = _turno_corrente(admin_client)
    _login(client, corrente["assegnato_username"])
    self_id = [r for r in admin_client.get("/api/pulizie/roommate").json() if r["username"] == corrente["assegnato_username"]][0]["user_id"]
    resp = client.post("/api/pulizie/swap", json={"settimana_idx": corrente["settimana_idx"], "target_id": self_id})
    assert resp.status_code == 400


def test_cannot_request_a_second_pending_swap_for_the_same_week(client, admin_client):
    ids = _configura_roommate(admin_client, ["alice", "bob", "carol"])
    corrente = _turno_corrente(admin_client)
    _login(client, corrente["assegnato_username"])
    roommate = admin_client.get("/api/pulizie/roommate").json()
    altro = [r["user_id"] for r in roommate if r["username"] != corrente["assegnato_username"]][0]
    resp1 = client.post("/api/pulizie/swap", json={"settimana_idx": corrente["settimana_idx"], "target_id": altro})
    assert resp1.status_code == 200
    resp2 = client.post("/api/pulizie/swap", json={"settimana_idx": corrente["settimana_idx"], "target_id": altro})
    assert resp2.status_code == 400


def test_target_can_accept_a_swap_and_it_updates_the_schedule(client, admin_client):
    _configura_roommate(admin_client, ["alice", "bob"])
    corrente = _turno_corrente(admin_client)
    richiedente = corrente["assegnato_username"]
    target_username = "bob" if richiedente == "alice" else "alice"
    _login(client, richiedente)
    target_id = [r for r in admin_client.get("/api/pulizie/roommate").json() if r["username"] == target_username][0]["user_id"]
    swap = client.post("/api/pulizie/swap", json={"settimana_idx": corrente["settimana_idx"], "target_id": target_id}).json()

    target_client = client
    _login(target_client, target_username)
    resp = target_client.post(f"/api/pulizie/swap/{swap['id']}/accetta")
    assert resp.status_code == 200
    assert resp.json()["stato"] == "accettata"

    settimane = admin_client.get("/api/pulizie/settimane").json()
    assert settimane[0]["assegnato_username"] == target_username


def test_only_target_can_accept(client, admin_client):
    _configura_roommate(admin_client, ["alice", "bob", "carol"])
    corrente = _turno_corrente(admin_client)
    richiedente = corrente["assegnato_username"]
    roommate = admin_client.get("/api/pulizie/roommate").json()
    target_username = [r["username"] for r in roommate if r["username"] != richiedente][0]
    terzo_username = [r["username"] for r in roommate if r["username"] not in (richiedente, target_username)][0]
    _login(client, richiedente)
    target_id = [r["user_id"] for r in roommate if r["username"] == target_username][0]
    swap = client.post("/api/pulizie/swap", json={"settimana_idx": corrente["settimana_idx"], "target_id": target_id}).json()

    _login(client, terzo_username)
    resp = client.post(f"/api/pulizie/swap/{swap['id']}/accetta")
    assert resp.status_code == 403


def test_requester_can_cancel_a_pending_swap(client, admin_client):
    _configura_roommate(admin_client, ["alice", "bob"])
    corrente = _turno_corrente(admin_client)
    richiedente = corrente["assegnato_username"]
    target_username = "bob" if richiedente == "alice" else "alice"
    _login(client, richiedente)
    target_id = [r for r in admin_client.get("/api/pulizie/roommate").json() if r["username"] == target_username][0]["user_id"]
    swap = client.post("/api/pulizie/swap", json={"settimana_idx": corrente["settimana_idx"], "target_id": target_id}).json()
    resp = client.post(f"/api/pulizie/swap/{swap['id']}/annulla")
    assert resp.status_code == 200
    assert resp.json()["stato"] == "annullata"


def test_pending_swap_shows_up_in_settimane_and_swap_mie(client, admin_client):
    _configura_roommate(admin_client, ["alice", "bob"])
    corrente = _turno_corrente(admin_client)
    richiedente = corrente["assegnato_username"]
    target_username = "bob" if richiedente == "alice" else "alice"
    _login(client, richiedente)
    target_id = [r for r in admin_client.get("/api/pulizie/roommate").json() if r["username"] == target_username][0]["user_id"]
    client.post("/api/pulizie/swap", json={"settimana_idx": corrente["settimana_idx"], "target_id": target_id})

    settimane = admin_client.get("/api/pulizie/settimane").json()
    assert settimane[0]["richiesta_pendente"]["target_username"] == target_username

    _login(client, target_username)
    mie = client.get("/api/pulizie/swap/mie").json()
    assert len(mie) == 1
    assert mie[0]["richiedente_username"] == richiedente
