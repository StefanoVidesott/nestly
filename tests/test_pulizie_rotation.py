from datetime import date


def _crea_utente(app, db, username):
    u = app.User(
        username=username,
        password_hash=app.hash_password("x"),
        role="user",
        allowed_modules="pulizie",
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def test_settimana_idx_is_deterministic_and_monotonic(app):
    assert app.settimana_idx(date(2020, 1, 6)) == 0
    assert app.settimana_idx(date(2020, 1, 12)) == 0
    assert app.settimana_idx(date(2020, 1, 13)) == 1
    assert app.settimana_idx(date(2020, 1, 20)) == 2


def test_data_settimana_is_the_inverse_of_settimana_idx(app):
    assert app.data_settimana(0) == date(2020, 1, 6)
    assert app.data_settimana(2) == date(2020, 1, 20)


def test_roommate_ordinati_respects_ordine(app, db):
    a = _crea_utente(app, db, "alice")
    b = _crea_utente(app, db, "bob")
    db.add(app.PulizieRoommate(user_id=b.id, ordine=0))
    db.add(app.PulizieRoommate(user_id=a.id, ordine=1))
    db.commit()
    ordinati = app.roommate_ordinati(db)
    assert [u.username for u in ordinati] == ["bob", "alice"]


def test_assicura_settimana_returns_none_without_roommates(app, db):
    assert app.assicura_settimana(db, 0) is None


def test_assicura_settimana_assigns_by_rotation_formula(app, db):
    a = _crea_utente(app, db, "alice")
    b = _crea_utente(app, db, "bob")
    db.add(app.PulizieRoommate(user_id=a.id, ordine=0))
    db.add(app.PulizieRoommate(user_id=b.id, ordine=1))
    db.commit()
    riga0 = app.assicura_settimana(db, 0)
    riga1 = app.assicura_settimana(db, 1)
    riga2 = app.assicura_settimana(db, 2)
    assert riga0.assegnato_user_id == a.id
    assert riga1.assegnato_user_id == b.id
    assert riga2.assegnato_user_id == a.id


def test_assicura_settimana_is_idempotent_and_ignores_later_roommate_changes(app, db):
    a = _crea_utente(app, db, "alice")
    b = _crea_utente(app, db, "bob")
    db.add(app.PulizieRoommate(user_id=a.id, ordine=0))
    db.commit()
    prima = app.assicura_settimana(db, 5)
    assert prima.assegnato_user_id == a.id

    db.add(app.PulizieRoommate(user_id=b.id, ordine=1))
    db.commit()
    dopo = app.assicura_settimana(db, 5)
    assert dopo.id == prima.id
    assert dopo.assegnato_user_id == a.id
