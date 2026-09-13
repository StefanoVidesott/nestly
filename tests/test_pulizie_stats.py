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


def _login(client, username):
    resp = client.post("/api/auth/login", json={"username": username, "password": "x"})
    assert resp.status_code == 200


def test_stats_are_empty_without_roommates(admin_client):
    resp = admin_client.get("/api/pulizie/stats")
    assert resp.status_code == 200
    assert resp.json() == []


def test_stats_reflect_assignments_completions_and_swaps(client, admin_client):
    _configura_roommate(admin_client, ["alice", "bob"])
    corrente = admin_client.get("/api/pulizie/settimane").json()[0]
    richiedente = corrente["assegnato_username"]
    target_username = "bob" if richiedente == "alice" else "alice"
    target_id = [r for r in admin_client.get("/api/pulizie/roommate").json() if r["username"] == target_username][0]["user_id"]

    _login(client, richiedente)
    swap = client.post("/api/pulizie/swap", json={"settimana_idx": corrente["settimana_idx"], "target_id": target_id}).json()
    _login(client, target_username)
    client.post(f"/api/pulizie/swap/{swap['id']}/accetta")
    client.post(f"/api/pulizie/settimane/{corrente['settimana_idx']}/completa")

    stats = {s["username"]: s for s in admin_client.get("/api/pulizie/stats").json()}
    assert stats[richiedente]["swap_richiesti"] == 1
    assert stats[richiedente]["swap_accettati_dati"] == 1
    assert stats[richiedente]["turni_completati"] == 0
    assert stats[target_username]["swap_accettati_ricevuti"] == 1
    assert stats[target_username]["turni_assegnati_totali"] == 1
    assert stats[target_username]["turni_completati"] == 1


def test_stats_includes_past_weeks(admin_client, db):
    from datetime import date
    import main

    _configura_roommate(admin_client, ["alice", "bob"])

    # Get the current week index
    oggi_idx = main.settimana_idx(date.today())
    past_idx = oggi_idx - 1

    # Get alice's user ID
    alice_id = [r for r in admin_client.get("/api/pulizie/roommate").json() if r["username"] == "alice"][0]["user_id"]

    # Directly create a past week assignment for alice, both assigned and completed
    past_week = main.PulizieSettimana(settimana_idx=past_idx, assegnato_user_id=alice_id, completato=True)
    db.add(past_week)
    db.commit()

    # Get stats
    stats = {s["username"]: s for s in admin_client.get("/api/pulizie/stats").json()}

    # Verify alice's past week is counted in both assigned and completed totals
    # alice should have at least 1 assigned (the past week)
    assert stats["alice"]["turni_assegnati_totali"] >= 1, "Past assigned week should be counted in totals"
    # alice should have at least 1 completed (the past completed week)
    assert stats["alice"]["turni_completati"] >= 1, "Past completed week should be counted in totals"
