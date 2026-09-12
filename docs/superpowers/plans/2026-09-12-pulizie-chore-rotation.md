# Pulizie (Chore Rotation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `pulizie` module to the Nestly app: a weekly chore rotation among admin-selected roommates, with per-roommate swap requests, completion tracking, and basic stats.

**Architecture:** Single-file backend convention is preserved — new SQLAlchemy models, Pydantic schemas, and `/api/pulizie/*` endpoints are added to `main.py` under a new `# ---------- 10. PULIZIE ----------` section, following the exact patterns used by the existing modules (`richiedi_modulo`, `MODULI`, ORM models with raw FK columns, no `relationship()`). Frontend follows the existing per-module pattern: a new `<section id="section-pulizie">` in `static/index.html` and a new `carica*`-function block in `static/app.js`, registered in `MODULO_META` / `CARICATORI_MODULO` / `TITOLI`. A rotation week is identified by a deterministic `settimana_idx` computed from a fixed epoch date — no per-week rows need to exist ahead of time; they're created lazily (`assicura_settimana`) the first time a week is viewed, swapped, or completed, so historical assignments never change retroactively when the roommate list is edited.

**Tech Stack:** FastAPI + SQLAlchemy + SQLite (existing), vanilla JS + Tailwind (existing). New: `pytest` + `httpx` (dev-only, for the test suite this plan introduces — the project currently has zero automated tests).

**Spec:** `docs/superpowers/specs/2026-09-12-pulizie-chore-rotation-design.md`

## Global Constraints

- Endpoint paths are prefixed `/api/` (e.g. `/api/pulizie/settimane`), matching every existing module.
- Python identifiers (functions, variables, DB fields) are Italian, matching the rest of `main.py`. User-facing `HTTPException` messages are English, matching the rest of `main.py` (e.g. `"Food item not found"`, `"Reminder not found"`) — the earlier spec draft said Italian error messages; this plan corrects that to match actual codebase convention.
- No `relationship()` — all cross-table lookups are manual `db.query(...).join(...)`, matching every existing model in `main.py`.
- No new frontend libraries (no chart library, no drag-and-drop library) — reordering uses up/down buttons, matching the "non troppo difficile" requirement and the fact that no such library is present in the project.
- All new DB tables are created automatically via the existing `Base.metadata.create_all(bind=engine)` call — no manual migration step needed (matches how every other module's tables were added).
- Dev-only test dependencies go in a new `requirements-dev.txt` (`-r requirements.txt` plus `pytest` and `httpx`), not in `requirements.txt` / `Dockerfile`, since the production image never runs tests.

---

### Task 1: Test harness + configurable database URL

**Files:**
- Modify: `main.py:19` (the `DATABASE_URL = ...` line)
- Create: `requirements-dev.txt`
- Create: `tests/__init__.py` (empty)
- Create: `tests/conftest.py`
- Create: `tests/test_smoke.py`

**Interfaces:**
- Produces: `DATABASE_URL` environment variable override, honored by `main.py` at import time.
- Produces: pytest fixtures `app` (freshly-imported `main` module bound to a temp SQLite file), `client` (`TestClient` over `app.app`), `db` (a `SessionLocal()` bound to the same temp DB), `admin_client` (a `client` already logged in as the default seeded admin).

This task exists because `main.py` currently hardcodes its SQLite path to `data/erasmus.db` — importing it in a test would open the real application database. Every later task's tests depend on this harness.

- [ ] **Step 1: Make the database URL overridable**

Change `main.py` line 19 from:
```python
DATABASE_URL = f"sqlite:///{DATA_DIR}/erasmus.db"
```
to:
```python
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{DATA_DIR}/erasmus.db")
```

- [ ] **Step 2: Verify the app still boots unchanged**

Run: `python -c "import main"`
Expected: no output, no exception (still uses `data/erasmus.db` by default since `DATABASE_URL` isn't set).

- [ ] **Step 3: Add dev requirements**

Create `requirements-dev.txt`:
```
-r requirements.txt
pytest==8.3.3
httpx==0.27.2
```

- [ ] **Step 4: Install dev requirements**

Run: `pip install -r requirements-dev.txt`
Expected: pytest and httpx install successfully.

- [ ] **Step 5: Write the test harness**

Create `tests/__init__.py` (empty file).

Create `tests/conftest.py`:
```python
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
```

- [ ] **Step 6: Write a smoke test**

Create `tests/test_smoke.py`:
```python
def test_unauthenticated_me_is_401(client):
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401


def test_admin_login_works(admin_client):
    resp = admin_client.get("/api/auth/me")
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"


def test_each_test_gets_an_isolated_database(app):
    assert app.DATABASE_URL != f"sqlite:///{app.DATA_DIR}/erasmus.db"
```

- [ ] **Step 7: Run the smoke tests**

Run: `pytest tests/test_smoke.py -v`
Expected: 3 passed.

- [ ] **Step 8: Commit**

```bash
git add main.py requirements-dev.txt tests/
git commit -m "test: add pytest harness with isolated per-test SQLite database"
```

---

### Task 2: Rotation core (models + week-assignment logic)

**Files:**
- Modify: `main.py` (add near the other model classes, e.g. after `MealPlan`, before `Base.metadata.create_all`)
- Modify: `main.py:30` (`MODULI` list)
- Test: `tests/test_pulizie_rotation.py`

**Interfaces:**
- Produces: `PulizieRoommate` model (`id`, `user_id`, `ordine`), `PulizieSettimana` model (`id`, `settimana_idx`, `assegnato_user_id`, `completato`, `completato_il`).
- Produces: `EPOCA_PULIZIE: date`, `settimana_idx(d: date) -> int`, `data_settimana(idx: int) -> date`, `roommate_ordinati(db: Session) -> list[User]`, `assicura_settimana(db: Session, idx: int) -> PulizieSettimana | None`.
- Consumed by: Tasks 3, 4, 5, 6 (backend), Task 7 (frontend, indirectly via the endpoints).

- [ ] **Step 1: Write the failing tests**

Create `tests/test_pulizie_rotation.py`:
```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_pulizie_rotation.py -v`
Expected: FAIL with `AttributeError: module 'main' has no attribute 'settimana_idx'` (or similar — none of these names exist yet).

- [ ] **Step 3: Add "pulizie" to MODULI**

In `main.py`, change:
```python
MODULI = ["lavanderia", "stanza", "dispensa", "finanza", "kanban", "bucketlist", "trondheim", "bookmark", "mealplan"]
```
to:
```python
MODULI = ["lavanderia", "stanza", "dispensa", "finanza", "kanban", "bucketlist", "trondheim", "bookmark", "mealplan", "pulizie"]
```

- [ ] **Step 4: Add the models**

In `main.py`, immediately before the `Base.metadata.create_all(bind=engine)` line, add:
```python
class PulizieRoommate(Base):
    __tablename__ = "pulizie_roommate"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("utenti.id"), nullable=False, unique=True, index=True)
    ordine = Column(Integer, nullable=False)


class PulizieSettimana(Base):
    __tablename__ = "pulizie_settimana"
    id = Column(Integer, primary_key=True, index=True)
    settimana_idx = Column(Integer, nullable=False, unique=True, index=True)
    assegnato_user_id = Column(Integer, ForeignKey("utenti.id"), nullable=False)
    completato = Column(Boolean, nullable=False, default=False)
    completato_il = Column(DateTime, nullable=True)


class PulizieSwapRichiesta(Base):
    __tablename__ = "pulizie_swap_richiesta"
    id = Column(Integer, primary_key=True, index=True)
    settimana_idx = Column(Integer, nullable=False, index=True)
    richiedente_id = Column(Integer, ForeignKey("utenti.id"), nullable=False)
    target_id = Column(Integer, ForeignKey("utenti.id"), nullable=False)
    stato = Column(String, nullable=False, default="in_attesa")  # in_attesa | accettata | rifiutata | annullata
    creato_il = Column(DateTime, nullable=False, default=datetime.utcnow)
    risposto_il = Column(DateTime, nullable=True)
```

(`PulizieSwapRichiesta` is defined here already, ahead of Task 5, since it's simplest to add all three tables in one place before the single `create_all` call.)

- [ ] **Step 5: Add the rotation helpers**

Directly below the models added in Step 4 (still before `Base.metadata.create_all`), add:
```python
EPOCA_PULIZIE = date(2020, 1, 6)  # un lunedì, punto di riferimento fisso per la rotazione


def settimana_idx(d: date) -> int:
    return (d - EPOCA_PULIZIE).days // 7


def data_settimana(idx: int) -> date:
    return EPOCA_PULIZIE + timedelta(weeks=idx)
```

After `Base.metadata.create_all(bind=engine)`, near the other helper functions (e.g. right after `moduli_utente`), add:
```python
def roommate_ordinati(db: Session) -> list[User]:
    righe = (
        db.query(PulizieRoommate, User)
        .join(User, User.id == PulizieRoommate.user_id)
        .order_by(PulizieRoommate.ordine)
        .all()
    )
    return [u for _, u in righe]


def assicura_settimana(db: Session, idx: int) -> Optional[PulizieSettimana]:
    riga = db.query(PulizieSettimana).filter(PulizieSettimana.settimana_idx == idx).first()
    if riga:
        return riga
    roommate = roommate_ordinati(db)
    if not roommate:
        return None
    assegnato = roommate[idx % len(roommate)]
    riga = PulizieSettimana(settimana_idx=idx, assegnato_user_id=assegnato.id)
    db.add(riga)
    db.commit()
    db.refresh(riga)
    return riga
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/test_pulizie_rotation.py -v`
Expected: 6 passed.

- [ ] **Step 7: Commit**

```bash
git add main.py tests/test_pulizie_rotation.py
git commit -m "feat: add pulizie rotation models and week-assignment logic"
```

---

### Task 3: Roommate admin endpoints

**Files:**
- Modify: `main.py` (Pydantic schemas section, endpoints section — new `# ---------- 10. PULIZIE ----------` block at the end of the endpoints)
- Test: `tests/test_pulizie_api.py`

**Interfaces:**
- Consumes: `PulizieRoommate`, `roommate_ordinati` (Task 2).
- Produces: `PulizieRoommateOut` schema, `PulizieRoommateIn` schema, `GET /api/pulizie/roommate`, `PUT /api/pulizie/roommate`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_pulizie_api.py`:
```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_pulizie_api.py -v`
Expected: FAIL with 404s (routes don't exist yet).

- [ ] **Step 3: Add the schemas**

In `main.py`, in the Pydantic schemas section (after the other `*In`/`*Out` classes), add:
```python
class PulizieRoommateIn(BaseModel):
    user_ids: list[int]


class PulizieRoommateOut(BaseModel):
    user_id: int
    username: str
    ordine: int
```

- [ ] **Step 4: Add the endpoints**

At the end of `main.py`, after the last existing endpoint, add:
```python
# ---------- 10. PULIZIE ----------

@app.get("/api/pulizie/roommate", response_model=list[PulizieRoommateOut])
def lista_roommate_pulizie(db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("pulizie"))):
    righe = (
        db.query(PulizieRoommate, User)
        .join(User, User.id == PulizieRoommate.user_id)
        .order_by(PulizieRoommate.ordine)
        .all()
    )
    return [PulizieRoommateOut(user_id=u.id, username=u.username, ordine=r.ordine) for r, u in righe]


@app.put("/api/pulizie/roommate", response_model=list[PulizieRoommateOut])
def imposta_roommate_pulizie(dati: PulizieRoommateIn, db: Session = Depends(get_db), admin: User = Depends(richiedi_admin)):
    if len(dati.user_ids) != len(set(dati.user_ids)):
        raise HTTPException(400, "Duplicate user in list")
    utenti_validi = {u.id for u in db.query(User).filter(User.id.in_(dati.user_ids)).all()}
    if len(utenti_validi) != len(dati.user_ids):
        raise HTTPException(400, "Unknown user in list")
    db.query(PulizieRoommate).delete()
    for posizione, uid in enumerate(dati.user_ids):
        db.add(PulizieRoommate(user_id=uid, ordine=posizione))
    db.commit()
    righe = (
        db.query(PulizieRoommate, User)
        .join(User, User.id == PulizieRoommate.user_id)
        .order_by(PulizieRoommate.ordine)
        .all()
    )
    return [PulizieRoommateOut(user_id=u.id, username=u.username, ordine=r.ordine) for r, u in righe]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_pulizie_api.py -v`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add main.py tests/test_pulizie_api.py
git commit -m "feat: add admin endpoints to configure pulizie rotation roommates"
```

---

### Task 4: Schedule + completion endpoints

**Files:**
- Modify: `main.py`
- Test: `tests/test_pulizie_api.py` (append)

**Interfaces:**
- Consumes: `assicura_settimana`, `data_settimana`, `settimana_idx` (Task 2), `PulizieRoommateOut`-style admin setup (Task 3, reused in tests).
- Produces: `PulizieSettimanaOut` schema (with `richiesta_pendente: Optional["PulizieSwapOut"]`, populated for real in Task 5 — `None` for now), `GET /api/pulizie/settimane`, `POST /api/pulizie/settimane/{idx}/completa`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_pulizie_api.py`:
```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_pulizie_api.py -v`
Expected: the 5 new tests FAIL with 404 (routes don't exist).

- [ ] **Step 3: Add the schema**

`PulizieSettimanaOut` references `PulizieSwapOut`, which doesn't exist until Task 5. Rather than leaving a dangling forward reference, add both the real class and a placeholder together, next to `PulizieRoommateOut`:
```python
class PulizieSettimanaOut(BaseModel):
    settimana_idx: int
    inizio: date
    assegnato_user_id: int
    assegnato_username: str
    completato: bool
    completato_il: Optional[datetime] = None
    richiesta_pendente: Optional["PulizieSwapOut"] = None


class PulizieSwapOut(BaseModel):
    id: int


PulizieSettimanaOut.model_rebuild()
```
`richiesta_pendente` is never actually populated in this task (always `None`, which is valid since the field has a default) — Task 5 replaces the placeholder `PulizieSwapOut` with its full definition, in place, leaving the `model_rebuild()` call below it untouched.

- [ ] **Step 4: Add the endpoints**

In `main.py`, inside the `# ---------- 10. PULIZIE ----------` section, after the roommate endpoints, add:
```python
@app.get("/api/pulizie/settimane", response_model=list[PulizieSettimanaOut])
def lista_settimane_pulizie(settimane: int = 4, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("pulizie"))):
    settimane = max(1, min(settimane, 26))
    oggi_idx = settimana_idx(date.today())
    risultato = []
    for offset in range(settimane):
        idx = oggi_idx + offset
        riga = assicura_settimana(db, idx)
        if not riga:
            break
        assegnato = db.query(User).get(riga.assegnato_user_id)
        risultato.append(PulizieSettimanaOut(
            settimana_idx=idx,
            inizio=data_settimana(idx),
            assegnato_user_id=assegnato.id,
            assegnato_username=assegnato.username,
            completato=riga.completato,
            completato_il=riga.completato_il,
        ))
    return risultato


@app.post("/api/pulizie/settimane/{idx}/completa", response_model=PulizieSettimanaOut)
def completa_settimana_pulizie(idx: int, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("pulizie"))):
    riga = assicura_settimana(db, idx)
    if not riga:
        raise HTTPException(404, "No roommates configured")
    if riga.assegnato_user_id != user.id:
        raise HTTPException(403, "Not your turn this week")
    if not riga.completato:
        riga.completato = True
        riga.completato_il = datetime.utcnow()
        db.commit()
        db.refresh(riga)
    assegnato = db.query(User).get(riga.assegnato_user_id)
    return PulizieSettimanaOut(
        settimana_idx=idx,
        inizio=data_settimana(idx),
        assegnato_user_id=assegnato.id,
        assegnato_username=assegnato.username,
        completato=riga.completato,
        completato_il=riga.completato_il,
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_pulizie_api.py -v`
Expected: 10 passed (5 from Task 3 + 5 new).

- [ ] **Step 6: Commit**

```bash
git add main.py tests/test_pulizie_api.py
git commit -m "feat: add pulizie schedule and completion endpoints"
```

---

### Task 5: Swap request lifecycle

**Files:**
- Modify: `main.py`
- Test: `tests/test_pulizie_swap.py`

**Interfaces:**
- Consumes: `PulizieSwapRichiesta` (Task 2), `assicura_settimana`, `settimana_idx` (Task 2), `PulizieSettimanaOut` placeholder (Task 4).
- Produces: full `PulizieSwapOut` schema (replaces the Task 4 placeholder), `PulizieSwapIn` schema, `_swap_out` helper, `POST /api/pulizie/swap`, `POST /api/pulizie/swap/{id}/accetta`, `POST /api/pulizie/swap/{id}/rifiuta`, `POST /api/pulizie/swap/{id}/annulla`, `GET /api/pulizie/swap/mie`.
- Produces (for Task 6): `richiesta_pendente` on `GET /api/pulizie/settimane` now actually populated.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_pulizie_swap.py`:
```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_pulizie_swap.py -v`
Expected: FAIL with 404s (routes don't exist yet).

- [ ] **Step 3: Replace the placeholder schema and add the real ones**

In `main.py`, replace the placeholder `class PulizieSwapOut(BaseModel): id: int` from Task 4 with the full definition, plus the new input schema. Leave the `PulizieSettimanaOut.model_rebuild()` line that already follows it unchanged:
```python
class PulizieSwapIn(BaseModel):
    settimana_idx: int
    target_id: int


class PulizieSwapOut(BaseModel):
    id: int
    settimana_idx: int
    inizio: date
    richiedente_id: int
    richiedente_username: str
    target_id: int
    target_username: str
    stato: str
    creato_il: datetime
```

- [ ] **Step 4: Add the `_swap_out` helper and the endpoints**

In `main.py`, inside the `# ---------- 10. PULIZIE ----------` section, add the helper right before the swap endpoints:
```python
def _swap_out(richiesta: PulizieSwapRichiesta, db: Session) -> PulizieSwapOut:
    richiedente = db.query(User).get(richiesta.richiedente_id)
    target = db.query(User).get(richiesta.target_id)
    return PulizieSwapOut(
        id=richiesta.id,
        settimana_idx=richiesta.settimana_idx,
        inizio=data_settimana(richiesta.settimana_idx),
        richiedente_id=richiesta.richiedente_id,
        richiedente_username=richiedente.username,
        target_id=richiesta.target_id,
        target_username=target.username,
        stato=richiesta.stato,
        creato_il=richiesta.creato_il,
    )


@app.post("/api/pulizie/swap", response_model=PulizieSwapOut)
def crea_richiesta_swap(dati: PulizieSwapIn, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("pulizie"))):
    oggi_idx = settimana_idx(date.today())
    if dati.settimana_idx < oggi_idx:
        raise HTTPException(400, "Cannot request a swap for a past week")
    riga = assicura_settimana(db, dati.settimana_idx)
    if not riga:
        raise HTTPException(404, "No roommates configured")
    if riga.assegnato_user_id != user.id:
        raise HTTPException(403, "Not your turn this week")
    if riga.completato:
        raise HTTPException(400, "Week already completed")
    if dati.target_id == user.id:
        raise HTTPException(400, "Cannot request a swap with yourself")
    target_valido = db.query(PulizieRoommate).filter(PulizieRoommate.user_id == dati.target_id).first()
    if not target_valido:
        raise HTTPException(400, "Target is not a roommate in the rotation")
    esistente = (
        db.query(PulizieSwapRichiesta)
        .filter(PulizieSwapRichiesta.settimana_idx == dati.settimana_idx, PulizieSwapRichiesta.stato == "in_attesa")
        .first()
    )
    if esistente:
        raise HTTPException(400, "A pending swap request already exists for this week")
    richiesta = PulizieSwapRichiesta(settimana_idx=dati.settimana_idx, richiedente_id=user.id, target_id=dati.target_id)
    db.add(richiesta)
    db.commit()
    db.refresh(richiesta)
    return _swap_out(richiesta, db)


@app.post("/api/pulizie/swap/{swap_id}/accetta", response_model=PulizieSwapOut)
def accetta_swap(swap_id: int, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("pulizie"))):
    richiesta = db.query(PulizieSwapRichiesta).get(swap_id)
    if not richiesta:
        raise HTTPException(404, "Swap request not found")
    if richiesta.target_id != user.id:
        raise HTTPException(403, "Only the target roommate can accept")
    if richiesta.stato != "in_attesa":
        raise HTTPException(400, "Request is no longer pending")
    settimana = db.query(PulizieSettimana).filter(PulizieSettimana.settimana_idx == richiesta.settimana_idx).first()
    if not settimana or settimana.assegnato_user_id != richiesta.richiedente_id:
        raise HTTPException(409, "Week assignment changed since the request was created")
    settimana.assegnato_user_id = richiesta.target_id
    richiesta.stato = "accettata"
    richiesta.risposto_il = datetime.utcnow()
    db.commit()
    db.refresh(richiesta)
    return _swap_out(richiesta, db)


@app.post("/api/pulizie/swap/{swap_id}/rifiuta", response_model=PulizieSwapOut)
def rifiuta_swap(swap_id: int, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("pulizie"))):
    richiesta = db.query(PulizieSwapRichiesta).get(swap_id)
    if not richiesta:
        raise HTTPException(404, "Swap request not found")
    if richiesta.target_id != user.id:
        raise HTTPException(403, "Only the target roommate can reject")
    if richiesta.stato != "in_attesa":
        raise HTTPException(400, "Request is no longer pending")
    richiesta.stato = "rifiutata"
    richiesta.risposto_il = datetime.utcnow()
    db.commit()
    db.refresh(richiesta)
    return _swap_out(richiesta, db)


@app.post("/api/pulizie/swap/{swap_id}/annulla", response_model=PulizieSwapOut)
def annulla_swap(swap_id: int, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("pulizie"))):
    richiesta = db.query(PulizieSwapRichiesta).get(swap_id)
    if not richiesta:
        raise HTTPException(404, "Swap request not found")
    if richiesta.richiedente_id != user.id:
        raise HTTPException(403, "Only the requester can cancel")
    if richiesta.stato != "in_attesa":
        raise HTTPException(400, "Request is no longer pending")
    richiesta.stato = "annullata"
    richiesta.risposto_il = datetime.utcnow()
    db.commit()
    db.refresh(richiesta)
    return _swap_out(richiesta, db)


@app.get("/api/pulizie/swap/mie", response_model=list[PulizieSwapOut])
def mie_richieste_swap(db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("pulizie"))):
    righe = (
        db.query(PulizieSwapRichiesta)
        .filter(
            PulizieSwapRichiesta.stato == "in_attesa",
            (PulizieSwapRichiesta.richiedente_id == user.id) | (PulizieSwapRichiesta.target_id == user.id),
        )
        .order_by(PulizieSwapRichiesta.creato_il)
        .all()
    )
    return [_swap_out(r, db) for r in righe]
```

- [ ] **Step 5: Populate `richiesta_pendente` in the schedule endpoint**

In `main.py`, in `lista_settimane_pulizie` (Task 4), inside the `for offset in range(settimane):` loop, right after computing `assegnato`, add:
```python
        richiesta = (
            db.query(PulizieSwapRichiesta)
            .filter(PulizieSwapRichiesta.settimana_idx == idx, PulizieSwapRichiesta.stato == "in_attesa")
            .first()
        )
```
and change the `PulizieSettimanaOut(...)` construction in that same function to add:
```python
            richiesta_pendente=_swap_out(richiesta, db) if richiesta else None,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/test_pulizie_swap.py -v`
Expected: 8 passed.

Run: `pytest tests/ -v`
Expected: all tests across all files still pass (no regressions in Tasks 1-4's tests from the schema/endpoint changes).

- [ ] **Step 7: Commit**

```bash
git add main.py tests/test_pulizie_swap.py
git commit -m "feat: add pulizie swap request lifecycle (create/accept/reject/cancel)"
```

---

### Task 6: Stats endpoint

**Files:**
- Modify: `main.py`
- Test: `tests/test_pulizie_stats.py`

**Interfaces:**
- Consumes: `PulizieSettimana`, `PulizieSwapRichiesta`, `roommate_ordinati` (Task 2/5).
- Produces: `PulizieStatOut` schema, `GET /api/pulizie/stats`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_pulizie_stats.py`:
```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_pulizie_stats.py -v`
Expected: FAIL with 404 (route doesn't exist).

- [ ] **Step 3: Add the schema**

In `main.py`, next to `PulizieRoommateOut`, add:
```python
class PulizieStatOut(BaseModel):
    user_id: int
    username: str
    turni_assegnati_totali: int
    turni_completati: int
    swap_richiesti: int
    swap_accettati_dati: int
    swap_accettati_ricevuti: int
```

- [ ] **Step 4: Add the endpoint**

In `main.py`, at the end of the `# ---------- 10. PULIZIE ----------` section, add:
```python
@app.get("/api/pulizie/stats", response_model=list[PulizieStatOut])
def stats_pulizie(db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("pulizie"))):
    risultato = []
    for u in roommate_ordinati(db):
        turni_assegnati = db.query(PulizieSettimana).filter(PulizieSettimana.assegnato_user_id == u.id).count()
        turni_completati = (
            db.query(PulizieSettimana)
            .filter(PulizieSettimana.assegnato_user_id == u.id, PulizieSettimana.completato == True)  # noqa: E712
            .count()
        )
        swap_richiesti = db.query(PulizieSwapRichiesta).filter(PulizieSwapRichiesta.richiedente_id == u.id).count()
        swap_dati = (
            db.query(PulizieSwapRichiesta)
            .filter(PulizieSwapRichiesta.richiedente_id == u.id, PulizieSwapRichiesta.stato == "accettata")
            .count()
        )
        swap_ricevuti = (
            db.query(PulizieSwapRichiesta)
            .filter(PulizieSwapRichiesta.target_id == u.id, PulizieSwapRichiesta.stato == "accettata")
            .count()
        )
        risultato.append(PulizieStatOut(
            user_id=u.id,
            username=u.username,
            turni_assegnati_totali=turni_assegnati,
            turni_completati=turni_completati,
            swap_richiesti=swap_richiesti,
            swap_accettati_dati=swap_dati,
            swap_accettati_ricevuti=swap_ricevuti,
        ))
    return risultato
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_pulizie_stats.py -v`
Expected: 2 passed.

Run: `pytest tests/ -v`
Expected: all tests pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add main.py tests/test_pulizie_stats.py
git commit -m "feat: add pulizie rotation stats endpoint"
```

---

### Task 7: Frontend section

**Files:**
- Modify: `static/index.html` (new `<section id="section-pulizie">`, placed right before `<!-- ===== ADMIN ===== -->`)
- Modify: `static/app.js` (new `MODULO_META`/`TITOLI`/`CARICATORI_MODULO` entries + new `# 10. PULIZIE` block at the end of the file)

**Interfaces:**
- Consumes: all `/api/pulizie/*` endpoints from Tasks 3-6; existing `apiGet`, `apiSend`, `formattaData`, `currentUser`, `MODULO_META`, `TITOLI`, `CARICATORI_MODULO` (all defined earlier in `app.js`).

There is no automated frontend test suite in this project (confirmed: zero `*.test.js` files, no JS test runner in `requirements.txt`/`package.json` — there is no `package.json`). This task's "test" step is a syntax check plus a manual verification checklist, matching how the existing barcode-scanner frontend work in this project was verified.

- [ ] **Step 1: Add the HTML section**

In `static/index.html`, immediately before the `<!-- ===== ADMIN ===== -->` comment, add:
```html
<!-- ===== PULIZIE ===== -->
<section id="section-pulizie" class="hidden space-y-6">
  <h1 class="text-2xl font-bold">Chores</h1>

  <div class="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-5 max-w-xl" id="pulizie-turno-corrente"></div>

  <div class="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-5 max-w-xl">
    <h2 class="text-lg font-semibold mb-4 flex items-center gap-2">
      <i class="fa-solid fa-calendar-week text-indigo-600"></i> Upcoming Weeks
    </h2>
    <div id="pulizie-settimane" class="space-y-2"></div>
  </div>

  <div class="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-5 max-w-xl">
    <h2 class="text-lg font-semibold mb-4 flex items-center gap-2">
      <i class="fa-solid fa-right-left text-indigo-600"></i> Swap Requests
    </h2>
    <div id="pulizie-swap-richieste" class="space-y-2"></div>
  </div>

  <div class="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-5 max-w-xl">
    <h2 class="text-lg font-semibold mb-4 flex items-center gap-2">
      <i class="fa-solid fa-chart-simple text-indigo-600"></i> Stats
    </h2>
    <div id="pulizie-stats" class="space-y-1 text-sm"></div>
  </div>

  <div id="pulizie-admin" class="hidden bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 p-5 max-w-xl">
    <h2 class="text-lg font-semibold mb-4 flex items-center gap-2">
      <i class="fa-solid fa-user-shield text-indigo-600"></i> Rotation Roommates (admin)
    </h2>
    <p class="text-xs text-slate-400 mb-2">Order defines the rotation. Use the arrows to reorder.</p>
    <div id="pulizie-roommate-lista" class="space-y-1 mb-3"></div>
    <div class="flex gap-2">
      <select id="pulizie-nuovo-roommate" class="flex-1 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-lg px-3 py-2 text-sm"></select>
      <button id="pulizie-aggiungi-roommate" type="button" class="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 text-sm font-medium transition">
        <i class="fa-solid fa-plus"></i>
      </button>
    </div>
  </div>

  <div id="modal-pulizie-swap" class="hidden fixed inset-0 bg-black/50 items-center justify-center z-50 p-4">
    <div class="bg-white dark:bg-slate-900 rounded-xl shadow-lg w-full max-w-sm p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-semibold">Request a swap</h3>
        <button type="button" id="pulizie-swap-chiudi" class="text-slate-400 hover:text-red-500"><i class="fa-solid fa-xmark text-lg"></i></button>
      </div>
      <form id="form-pulizie-swap" class="space-y-3">
        <input type="hidden" id="pulizie-swap-settimana" />
        <select id="pulizie-swap-target" required class="w-full border border-slate-300 dark:border-slate-700 dark:bg-slate-800 rounded-lg px-3 py-2 text-sm"></select>
        <button class="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition">
          Send Request
        </button>
      </form>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Register the module in `app.js`**

In `static/app.js`, change:
```javascript
const MODULO_META = {
  lavanderia: { label: "Laundry", icon: "fa-shirt" },
  stanza: { label: "Room & Cleaning", icon: "fa-broom" },
  dispensa: { label: "Pantry & Fridge", icon: "fa-kitchen-set" },
  finanza: { label: "Finance & Expenses", icon: "fa-sack-dollar" },
  kanban: { label: "Kanban", icon: "fa-table-columns" },
  bucketlist: { label: "Bucket List", icon: "fa-list-check" },
  trondheim: { label: "Trondheim", icon: "fa-city" },
  bookmark: { label: "Bookmarks & Resources", icon: "fa-bookmark" },
  mealplan: { label: "Kitchen & Meal Plan", icon: "fa-utensils" },
};
```
to (adding the `pulizie` entry):
```javascript
const MODULO_META = {
  lavanderia: { label: "Laundry", icon: "fa-shirt" },
  stanza: { label: "Room & Cleaning", icon: "fa-broom" },
  dispensa: { label: "Pantry & Fridge", icon: "fa-kitchen-set" },
  finanza: { label: "Finance & Expenses", icon: "fa-sack-dollar" },
  kanban: { label: "Kanban", icon: "fa-table-columns" },
  bucketlist: { label: "Bucket List", icon: "fa-list-check" },
  trondheim: { label: "Trondheim", icon: "fa-city" },
  bookmark: { label: "Bookmarks & Resources", icon: "fa-bookmark" },
  mealplan: { label: "Kitchen & Meal Plan", icon: "fa-utensils" },
  pulizie: { label: "Chores", icon: "fa-arrows-rotate" },
};
```

Change:
```javascript
const CARICATORI_MODULO = {
  lavanderia: [caricaLavanderia, caricaBucato],
  stanza: [caricaIgiene],
  dispensa: [caricaFrigo, caricaListaSpesa, caricaRicette],
  finanza: [caricaTassoCambio],
  kanban: [caricaKanban, caricaTodo],
  bucketlist: [caricaBucketList],
  trondheim: [avviaTrasporti, caricaKp, caricaMeteo],
  bookmark: [caricaBookmark],
  mealplan: [caricaAntiSpreco, caricaGrigliaMealPlan],
};
```
to:
```javascript
const CARICATORI_MODULO = {
  lavanderia: [caricaLavanderia, caricaBucato],
  stanza: [caricaIgiene],
  dispensa: [caricaFrigo, caricaListaSpesa, caricaRicette],
  finanza: [caricaTassoCambio],
  kanban: [caricaKanban, caricaTodo],
  bucketlist: [caricaBucketList],
  trondheim: [avviaTrasporti, caricaKp, caricaMeteo],
  bookmark: [caricaBookmark],
  mealplan: [caricaAntiSpreco, caricaGrigliaMealPlan],
  pulizie: [caricaPulizie],
};
```

Change:
```javascript
const TITOLI = {
  lavanderia: "Laundry", stanza: "Room & Cleaning", dispensa: "Pantry & Fridge",
  finanza: "Finance & Expenses", admin: "Admin Settings",
  kanban: "Kanban", bucketlist: "Bucket List", trondheim: "Trondheim",
  bookmark: "Bookmarks & Resources", mealplan: "Kitchen & Meal Plan",
};
```
to:
```javascript
const TITOLI = {
  lavanderia: "Laundry", stanza: "Room & Cleaning", dispensa: "Pantry & Fridge",
  finanza: "Finance & Expenses", admin: "Admin Settings",
  kanban: "Kanban", bucketlist: "Bucket List", trondheim: "Trondheim",
  bookmark: "Bookmarks & Resources", mealplan: "Kitchen & Meal Plan",
  pulizie: "Chores",
};
```

- [ ] **Step 3: Add the module's JS logic**

At the end of `static/app.js`, add:
```javascript
// ================= 10. PULIZIE (chore rotation) =================

let pulizieRoommateCache = [];

async function caricaPulizie() {
  await caricaPulizieRoommate();
  await Promise.all([caricaPulizieSettimane(), caricaPulizieSwapRichieste(), caricaPulizieStats()]);
}

async function caricaPulizieRoommate() {
  pulizieRoommateCache = await apiGet("/pulizie/roommate");
  if (currentUser.role === "admin") {
    document.getElementById("pulizie-admin").classList.remove("hidden");
    await renderPulizieAdmin();
  }
}

async function renderPulizieAdmin() {
  const cont = document.getElementById("pulizie-roommate-lista");
  cont.innerHTML = "";
  pulizieRoommateCache.forEach((r, i) => {
    const div = document.createElement("div");
    div.className = "flex items-center gap-2 text-sm px-1 py-1";
    div.innerHTML = `
      <span class="w-5 text-slate-400">${i + 1}.</span>
      <span class="flex-1">${r.username}</span>
      <button data-idx="${i}" class="btn-pulizie-su text-slate-400 hover:text-indigo-600" ${i === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-up"></i></button>
      <button data-idx="${i}" class="btn-pulizie-giu text-slate-400 hover:text-indigo-600" ${i === pulizieRoommateCache.length - 1 ? "disabled" : ""}><i class="fa-solid fa-arrow-down"></i></button>
      <button data-idx="${i}" class="btn-pulizie-rimuovi text-slate-400 hover:text-red-500"><i class="fa-solid fa-xmark"></i></button>
    `;
    cont.appendChild(div);
  });
  cont.querySelectorAll(".btn-pulizie-su").forEach((b) => b.addEventListener("click", () => spostaPulizieRoommate(Number(b.dataset.idx), -1)));
  cont.querySelectorAll(".btn-pulizie-giu").forEach((b) => b.addEventListener("click", () => spostaPulizieRoommate(Number(b.dataset.idx), 1)));
  cont.querySelectorAll(".btn-pulizie-rimuovi").forEach((b) => b.addEventListener("click", () => rimuoviPulizieRoommate(Number(b.dataset.idx))));

  const tutti = await apiGet("/admin/users");
  const select = document.getElementById("pulizie-nuovo-roommate");
  const inRotazione = new Set(pulizieRoommateCache.map((r) => r.user_id));
  select.innerHTML = tutti
    .filter((u) => !inRotazione.has(u.id))
    .map((u) => `<option value="${u.id}">${u.username}</option>`)
    .join("");
}

async function salvaOrdinePulizieRoommate() {
  const user_ids = pulizieRoommateCache.map((r) => r.user_id);
  pulizieRoommateCache = await apiSend("/pulizie/roommate", "PUT", { user_ids });
  await renderPulizieAdmin();
}

function spostaPulizieRoommate(indice, direzione) {
  const nuovoIndice = indice + direzione;
  if (nuovoIndice < 0 || nuovoIndice >= pulizieRoommateCache.length) return;
  const [riga] = pulizieRoommateCache.splice(indice, 1);
  pulizieRoommateCache.splice(nuovoIndice, 0, riga);
  salvaOrdinePulizieRoommate();
}

function rimuoviPulizieRoommate(indice) {
  pulizieRoommateCache.splice(indice, 1);
  salvaOrdinePulizieRoommate();
}

document.getElementById("pulizie-aggiungi-roommate").addEventListener("click", () => {
  const select = document.getElementById("pulizie-nuovo-roommate");
  if (!select.value) return;
  pulizieRoommateCache.push({
    user_id: Number(select.value),
    username: select.options[select.selectedIndex].textContent,
    ordine: pulizieRoommateCache.length,
  });
  salvaOrdinePulizieRoommate();
});

async function caricaPulizieSettimane() {
  const settimane = await apiGet("/pulizie/settimane?settimane=6");
  const corrente = settimane[0];
  const contCorrente = document.getElementById("pulizie-turno-corrente");
  if (!corrente) {
    contCorrente.innerHTML = `<p class="text-sm text-slate-400">No roommates configured yet.</p>`;
    document.getElementById("pulizie-settimane").innerHTML = "";
    return;
  }
  const mioTurno = corrente.assegnato_username === currentUser.username;
  contCorrente.innerHTML = `
    <h2 class="text-lg font-semibold mb-2 flex items-center gap-2">
      <i class="fa-solid fa-broom text-indigo-600"></i> This Week
    </h2>
    <p class="text-sm mb-3">${corrente.assegnato_username} is on cleaning duty ${corrente.completato ? '<span class="text-emerald-600">(done)</span>' : ""}</p>
    <div class="flex gap-2">
      ${mioTurno && !corrente.completato ? `<button id="btn-pulizie-completa" class="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition"><i class="fa-solid fa-check"></i> Mark done</button>` : ""}
      ${mioTurno && !corrente.completato && !corrente.richiesta_pendente ? `<button id="btn-pulizie-swap" class="bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-lg px-4 py-2 text-sm font-medium transition"><i class="fa-solid fa-right-left"></i> Request swap</button>` : ""}
    </div>
    ${corrente.richiesta_pendente ? `<p class="text-xs text-slate-400 mt-2">Swap requested to ${corrente.richiesta_pendente.target_username} — pending</p>` : ""}
  `;
  document.getElementById("btn-pulizie-completa")?.addEventListener("click", async () => {
    await apiSend(`/pulizie/settimane/${corrente.settimana_idx}/completa`, "POST");
    caricaPulizie();
  });
  document.getElementById("btn-pulizie-swap")?.addEventListener("click", () => apriModalePulizieSwap(corrente.settimana_idx));

  const cont = document.getElementById("pulizie-settimane");
  cont.innerHTML = "";
  for (const s of settimane.slice(1)) {
    const div = document.createElement("div");
    div.className = "flex items-center justify-between text-sm px-1 py-1 border-b border-slate-100 dark:border-slate-800 last:border-0";
    div.innerHTML = `<span>${formattaData(s.inizio)}</span><span class="font-medium">${s.assegnato_username}</span>`;
    cont.appendChild(div);
  }
}

function apriModalePulizieSwap(settimana_idx) {
  document.getElementById("pulizie-swap-settimana").value = settimana_idx;
  const select = document.getElementById("pulizie-swap-target");
  select.innerHTML = pulizieRoommateCache
    .filter((r) => r.username !== currentUser.username)
    .map((r) => `<option value="${r.user_id}">${r.username}</option>`)
    .join("");
  document.getElementById("modal-pulizie-swap").classList.remove("hidden");
  document.getElementById("modal-pulizie-swap").classList.add("flex");
}

function chiudiModalePulizieSwap() {
  document.getElementById("modal-pulizie-swap").classList.add("hidden");
  document.getElementById("modal-pulizie-swap").classList.remove("flex");
}

document.getElementById("pulizie-swap-chiudi").addEventListener("click", chiudiModalePulizieSwap);

document.getElementById("form-pulizie-swap").addEventListener("submit", async (e) => {
  e.preventDefault();
  const settimana_idx = Number(document.getElementById("pulizie-swap-settimana").value);
  const target_id = Number(document.getElementById("pulizie-swap-target").value);
  await apiSend("/pulizie/swap", "POST", { settimana_idx, target_id });
  chiudiModalePulizieSwap();
  caricaPulizie();
});

async function caricaPulizieSwapRichieste() {
  const richieste = await apiGet("/pulizie/swap/mie");
  const cont = document.getElementById("pulizie-swap-richieste");
  cont.innerHTML = "";
  if (richieste.length === 0) {
    cont.innerHTML = `<p class="text-sm text-slate-400">No pending swap requests.</p>`;
    return;
  }
  for (const r of richieste) {
    const inArrivo = r.target_username === currentUser.username;
    const div = document.createElement("div");
    div.className = "flex items-center justify-between gap-2 text-sm px-1 py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0";
    div.innerHTML = `
      <span>${formattaData(r.inizio)} — ${inArrivo ? `${r.richiedente_username} wants you to cover their turn` : `Waiting for ${r.target_username} to respond`}</span>
      <div class="flex gap-2 shrink-0">
        ${inArrivo
          ? `<button data-id="${r.id}" class="btn-pulizie-swap-accetta text-emerald-600 hover:text-emerald-700"><i class="fa-solid fa-check"></i></button>
             <button data-id="${r.id}" class="btn-pulizie-swap-rifiuta text-red-500 hover:text-red-600"><i class="fa-solid fa-xmark"></i></button>`
          : `<button data-id="${r.id}" class="btn-pulizie-swap-annulla text-slate-400 hover:text-red-500"><i class="fa-solid fa-ban"></i></button>`}
      </div>
    `;
    cont.appendChild(div);
  }
  cont.querySelectorAll(".btn-pulizie-swap-accetta").forEach((b) => b.addEventListener("click", async () => { await apiSend(`/pulizie/swap/${b.dataset.id}/accetta`, "POST"); caricaPulizie(); }));
  cont.querySelectorAll(".btn-pulizie-swap-rifiuta").forEach((b) => b.addEventListener("click", async () => { await apiSend(`/pulizie/swap/${b.dataset.id}/rifiuta`, "POST"); caricaPulizie(); }));
  cont.querySelectorAll(".btn-pulizie-swap-annulla").forEach((b) => b.addEventListener("click", async () => { await apiSend(`/pulizie/swap/${b.dataset.id}/annulla`, "POST"); caricaPulizie(); }));
}

async function caricaPulizieStats() {
  const stats = await apiGet("/pulizie/stats");
  const cont = document.getElementById("pulizie-stats");
  cont.innerHTML = "";
  if (stats.length === 0) {
    cont.innerHTML = `<p class="text-slate-400">No data yet.</p>`;
    return;
  }
  for (const s of stats) {
    const div = document.createElement("div");
    div.className = "flex items-center justify-between px-1 py-1 border-b border-slate-100 dark:border-slate-800 last:border-0";
    div.innerHTML = `<span class="font-medium">${s.username}</span><span class="text-slate-500">${s.turni_completati}/${s.turni_assegnati_totali} done · ${s.swap_accettati_dati} swaps given · ${s.swap_accettati_ricevuti} swaps received</span>`;
    cont.appendChild(div);
  }
}
```

- [ ] **Step 4: Syntax-check the JS**

Run: `node -c static/app.js`
Expected: no output, exit code 0.

- [ ] **Step 5: Manual verification checklist**

Run the app locally (`uvicorn main:app --reload` with a scratch `DATABASE_URL` env var pointing at a temp file, to avoid touching production data) and, logged in as the seeded admin (`admin`/`admin`):
1. Create 2-3 test users with the `pulizie` module enabled.
2. Open "Chores" in the sidebar — confirm "No roommates configured yet" shows.
3. In the admin roommate panel, add the test users in a specific order — confirm "This Week" shows the first one.
4. Log in as that first user (separate browser/incognito window) — confirm "Mark done" and "Request swap" buttons appear, but not for other users.
5. Request a swap to a specific roommate — log in as that roommate — confirm the incoming request appears under "Swap Requests" and accepting it changes "This Week" to their name.
6. Mark the week done — confirm the "(done)" badge appears and the Stats panel reflects the completion.
7. Reorder/remove a roommate as admin — confirm past (already-viewed) weeks are unaffected.

- [ ] **Step 6: Commit**

```bash
git add static/index.html static/app.js
git commit -m "feat: add pulizie chore rotation frontend"
```

---

### Task 8: Deploy

**Files:** none (operational task)

- [ ] **Step 1: Run the full test suite one more time**

Run: `pytest tests/ -v`
Expected: all tests pass.

- [ ] **Step 2: Rebuild and redeploy the container**

```bash
docker compose build && docker compose up -d
```

- [ ] **Step 3: Verify the deployed static files contain the new module**

```bash
docker exec nestly grep -c "section-pulizie" /app/static/index.html
docker exec nestly grep -c "caricaPulizie" /app/static/app.js
```
Expected: both print `1` or more.

- [ ] **Step 4: Remind about CDN cache**

No CDN-loaded assets were added for this feature (unlike the barcode scanner), so no Cloudflare cache purge is needed for functionality — but if the user tests through `stefano.crabdance.com` rather than directly against the container, mention that a hard refresh may still be needed for `index.html`/`app.js` given the project's known cache-control history.
