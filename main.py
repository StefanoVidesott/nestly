import hashlib
import os
import secrets
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Optional

import jwt
from fastapi import FastAPI, HTTPException, Depends, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import create_engine, Column, Integer, String, Date, Time, Boolean, DateTime, Float, ForeignKey, UniqueConstraint, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker, Session

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{DATA_DIR}/erasmus.db")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

SECRET_KEY = os.environ.get("SECRET_KEY", "nestly-dev-secret-change-me")
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24 * 7
COOKIE_NAME = "session_token"

MODULI = ["lavanderia", "stanza", "dispensa", "finanza", "kanban", "bucketlist", "trondheim", "bookmark", "mealplan", "pulizie"]


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------- MODELLI DB ----------

class User(Base):
    __tablename__ = "utenti"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False, default="user")  # "admin" | "user"
    allowed_modules = Column(String, nullable=False, default="")  # csv di MODULI


class Prenotazione(Base):
    __tablename__ = "prenotazioni"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("utenti.id"), nullable=False, index=True)
    macchina = Column(String, nullable=False)  # "Lavatrice" | "Asciugatrice"
    data = Column(Date, nullable=False)
    ora_inizio = Column(Time, nullable=False)
    ora_fine = Column(Time, nullable=False)


class CapoBucato(Base):
    __tablename__ = "cesto_biancheria"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("utenti.id"), nullable=False, index=True)
    nome = Column(String, nullable=False)
    temperatura = Column(Integer, nullable=False)  # 30 | 40 | 60
    created_at = Column(DateTime, default=datetime.utcnow)


class IgieneLog(Base):
    __tablename__ = "igiene_log"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("utenti.id"), nullable=False, index=True)
    tipo = Column(String, nullable=False)  # nome del promemoria, es. "pulizia"
    data = Column(Date, nullable=False, default=date.today)


class IgieneTipo(Base):
    __tablename__ = "igiene_tipi"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("utenti.id"), nullable=False, index=True)
    tipo = Column(String, nullable=False)
    target_giorni = Column(Integer, nullable=False)
    __table_args__ = (UniqueConstraint("user_id", "tipo", name="uq_igiene_tipo_utente"),)


class AlimentoFrigo(Base):
    __tablename__ = "frigo"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("utenti.id"), nullable=False, index=True)
    nome = Column(String, nullable=False)
    quantita = Column(String, nullable=False)
    scadenza = Column(Date, nullable=True)
    luogo = Column(String, nullable=False, default="frigo")  # "frigo" | "freezer"


class Prodotto(Base):
    __tablename__ = "prodotti"
    barcode = Column(String, primary_key=True, index=True)
    nome = Column(String, nullable=False)
    quantita_default = Column(String, nullable=False)
    scadenza_giorni_default = Column(Integer, nullable=True)
    luogo_default = Column(String, nullable=False, default="frigo")  # "frigo" | "freezer"


class SpesaItem(Base):
    __tablename__ = "spesa"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("utenti.id"), nullable=False, index=True)
    nome = Column(String, nullable=False)
    quantita = Column(String, nullable=True)
    comprato = Column(Boolean, default=False)


class Recipe(Base):
    __tablename__ = "recipes"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("utenti.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    content = Column(String, nullable=False)
    is_shared = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class TodoItem(Base):
    __tablename__ = "todo"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("utenti.id"), nullable=False, index=True)
    testo = Column(String, nullable=False)
    fatto = Column(Boolean, default=False)


class Expense(Base):
    __tablename__ = "spese"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("utenti.id"), nullable=False, index=True)
    data = Column(Date, nullable=False)
    importo = Column(Float, nullable=False)
    valuta = Column(String, nullable=False)  # "NOK" | "EUR"
    descrizione = Column(String, nullable=False)
    categoria = Column(String, nullable=False)


class SharedBucketListItem(Base):
    __tablename__ = "bucket_list"
    id = Column(Integer, primary_key=True, index=True)
    text = Column(String, nullable=False)
    is_completed = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class KanbanTask(Base):
    __tablename__ = "kanban_tasks"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("utenti.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    description = Column(String, nullable=True)
    status = Column(String, nullable=False, default="todo")  # "todo" | "doing" | "done"
    created_at = Column(DateTime, default=datetime.utcnow)


class Bookmark(Base):
    __tablename__ = "bookmarks"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("utenti.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    url = Column(String, nullable=False)
    category = Column(String, nullable=False)


class MealPlan(Base):
    __tablename__ = "meal_plan"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("utenti.id"), nullable=False, index=True)
    data = Column(Date, nullable=False)
    meal_type = Column(String, nullable=False)  # "Pranzo" | "Cena"
    recipe = Column(String, nullable=False)
    __table_args__ = (UniqueConstraint("user_id", "data", "meal_type", name="uq_mealplan_utente_data_tipo"),)


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


EPOCA_PULIZIE = date(2020, 1, 6)  # un lunedì, punto di riferimento fisso per la rotazione


def settimana_idx(d: date) -> int:
    return (d - EPOCA_PULIZIE).days // 7


def data_settimana(idx: int) -> date:
    return EPOCA_PULIZIE + timedelta(weeks=idx)


Base.metadata.create_all(bind=engine)

# Lightweight auto-migration: add columns introduced after initial deploy
# (create_all only creates missing tables, not missing columns on existing ones).
with engine.begin() as conn:
    frigo_cols = {c["name"] for c in inspect(engine).get_columns("frigo")}
    if "luogo" not in frigo_cols:
        conn.execute(text("ALTER TABLE frigo ADD COLUMN luogo VARCHAR NOT NULL DEFAULT 'frigo'"))


# ---------- AUTENTICAZIONE ----------

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
    return f"{salt}${h.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, hex_hash = stored.split("$")
    except ValueError:
        return False
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
    return secrets.compare_digest(h.hex(), hex_hash)


def crea_token(user: User) -> str:
    payload = {
        "sub": str(user.id),
        "exp": datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def moduli_utente(user: User) -> list[str]:
    if user.role == "admin":
        return list(MODULI)
    return [m for m in user.allowed_modules.split(",") if m]


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


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(401, "Invalid session")
    user = db.query(User).get(user_id)
    if not user:
        raise HTTPException(401, "User not found")
    return user


def richiedi_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Access restricted to administrators")
    return user


def richiedi_modulo(modulo: str):
    def dipendenza(user: User = Depends(get_current_user)) -> User:
        if modulo not in moduli_utente(user):
            raise HTTPException(403, "No access to this module")
        return user
    return dipendenza


def crea_admin_default_se_vuoto():
    db = SessionLocal()
    try:
        if db.query(User).count() == 0:
            admin = User(
                username="admin",
                password_hash=hash_password("admin"),
                role="admin",
                allowed_modules=",".join(MODULI),
            )
            db.add(admin)
            db.commit()
    finally:
        db.close()


crea_admin_default_se_vuoto()


# ---------- SCHEMI PYDANTIC ----------

class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    allowed_modules: list[str]


class UserCreateIn(BaseModel):
    username: str
    password: str
    role: str = "user"
    allowed_modules: list[str] = []


class UserUpdateIn(BaseModel):
    username: str
    password: Optional[str] = None
    role: str
    allowed_modules: list[str] = []


class BucketItemIn(BaseModel):
    text: str


class BucketItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    text: str
    is_completed: bool


class KanbanTaskIn(BaseModel):
    title: str
    description: Optional[str] = None


class KanbanTaskStatusIn(BaseModel):
    status: str


class KanbanTaskUpdateIn(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None


class KanbanTaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    description: Optional[str]
    status: str


class ExpenseUpdateIn(BaseModel):
    importo: Optional[float] = None
    descrizione: Optional[str] = None
    categoria: Optional[str] = None


class BookmarkIn(BaseModel):
    title: str
    url: str
    category: str


class BookmarkOut(BookmarkIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class MealPlanIn(BaseModel):
    data: date
    meal_type: str
    recipe: str


class MealPlanOut(MealPlanIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class PrenotazioneIn(BaseModel):
    macchina: str
    data: date
    ora_inizio: time
    ora_fine: time


class PrenotazioneOut(PrenotazioneIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class CapoBucatoIn(BaseModel):
    nome: str
    temperatura: int


class CapoBucatoOut(CapoBucatoIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class CapoBucatoUpdateIn(BaseModel):
    nome: Optional[str] = None
    temperatura: Optional[int] = None


class AlimentoFrigoIn(BaseModel):
    nome: str
    quantita: str
    scadenza: Optional[date] = None
    luogo: str = "frigo"


class AlimentoFrigoOut(AlimentoFrigoIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class AlimentoFrigoUpdateIn(BaseModel):
    nome: Optional[str] = None
    quantita: Optional[str] = None


class ProdottoIn(BaseModel):
    barcode: str
    nome: str
    quantita_default: str
    scadenza_giorni_default: Optional[int] = None
    luogo_default: str = "frigo"


class ProdottoOut(ProdottoIn):
    model_config = ConfigDict(from_attributes=True)


class SpesaItemIn(BaseModel):
    nome: str
    quantita: Optional[str] = None


class SpesaItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    nome: str
    quantita: Optional[str]
    comprato: bool


class SpesaItemUpdateIn(BaseModel):
    nome: Optional[str] = None
    quantita: Optional[str] = None


class RecipeIn(BaseModel):
    title: str
    content: str
    is_shared: bool = False


class RecipeUpdateIn(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    is_shared: Optional[bool] = None


class RecipeOut(BaseModel):
    id: int
    title: str
    content: str
    is_shared: bool
    owner_username: str
    is_mine: bool


class TodoItemIn(BaseModel):
    testo: str


class TodoItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    testo: str
    fatto: bool


class IgieneStatoOut(BaseModel):
    ultima_data: Optional[date]
    giorni_rimanenti: Optional[int]
    scaduto: bool
    target_giorni: int


class IgieneTipoIn(BaseModel):
    tipo: str
    target_giorni: int


class IgieneTipoUpdateIn(BaseModel):
    target_giorni: int


class IgieneTipoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    tipo: str
    target_giorni: int


class ExpenseIn(BaseModel):
    data: date
    importo: float
    valuta: str
    descrizione: str
    categoria: str


class ExpenseOut(ExpenseIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


IGIENE_TIPI_DEFAULT = {"cleaning": 7, "towels": 7, "sheets": 14}

app = FastAPI(title="Nestly")


# ---------- AUTH ----------

@app.post("/api/auth/login", response_model=UserOut)
def login(dati: LoginIn, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == dati.username).first()
    if not user or not verify_password(dati.password, user.password_hash):
        raise HTTPException(401, "Incorrect username or password")
    token = crea_token(user)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=TOKEN_EXPIRE_HOURS * 3600,
    )
    return UserOut(id=user.id, username=user.username, role=user.role, allowed_modules=moduli_utente(user))


@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@app.get("/api/auth/me", response_model=UserOut)
def chi_sono(user: User = Depends(get_current_user)):
    return UserOut(id=user.id, username=user.username, role=user.role, allowed_modules=moduli_utente(user))


# ---------- ADMIN ----------

@app.get("/api/admin/users", response_model=list[UserOut])
def lista_utenti(db: Session = Depends(get_db), admin: User = Depends(richiedi_admin)):
    return [
        UserOut(id=u.id, username=u.username, role=u.role, allowed_modules=moduli_utente(u))
        for u in db.query(User).order_by(User.id).all()
    ]


@app.post("/api/admin/users", response_model=UserOut)
def crea_utente(dati: UserCreateIn, db: Session = Depends(get_db), admin: User = Depends(richiedi_admin)):
    if dati.role not in ("admin", "user"):
        raise HTTPException(400, "Invalid role")
    if db.query(User).filter(User.username == dati.username).first():
        raise HTTPException(400, "Username already exists")
    moduli_validi = [m for m in dati.allowed_modules if m in MODULI]
    nuovo = User(
        username=dati.username,
        password_hash=hash_password(dati.password),
        role=dati.role,
        allowed_modules=",".join(moduli_validi),
    )
    db.add(nuovo)
    db.commit()
    db.refresh(nuovo)
    return UserOut(id=nuovo.id, username=nuovo.username, role=nuovo.role, allowed_modules=moduli_utente(nuovo))


@app.put("/api/admin/users/{user_id}", response_model=UserOut)
def modifica_utente(user_id: int, dati: UserUpdateIn, db: Session = Depends(get_db), admin: User = Depends(richiedi_admin)):
    riga = db.query(User).get(user_id)
    if not riga:
        raise HTTPException(404, "User not found")
    if dati.role not in ("admin", "user"):
        raise HTTPException(400, "Invalid role")
    esistente = db.query(User).filter(User.username == dati.username, User.id != user_id).first()
    if esistente:
        raise HTTPException(400, "Username already exists")
    riga.username = dati.username
    riga.role = dati.role
    riga.allowed_modules = ",".join([m for m in dati.allowed_modules if m in MODULI])
    if dati.password:
        riga.password_hash = hash_password(dati.password)
    db.commit()
    db.refresh(riga)
    return UserOut(id=riga.id, username=riga.username, role=riga.role, allowed_modules=moduli_utente(riga))


# ---------- 1. LAVANDERIA ----------

@app.get("/api/lavanderia", response_model=list[PrenotazioneOut])
def lista_prenotazioni(db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("lavanderia"))):
    return (
        db.query(Prenotazione)
        .filter(Prenotazione.user_id == user.id)
        .order_by(Prenotazione.data, Prenotazione.ora_inizio)
        .all()
    )


@app.post("/api/lavanderia", response_model=PrenotazioneOut)
def crea_prenotazione(p: PrenotazioneIn, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("lavanderia"))):
    if p.macchina not in ("Lavatrice", "Asciugatrice"):
        raise HTTPException(400, "Invalid machine")
    if p.ora_fine <= p.ora_inizio:
        raise HTTPException(400, "End time must be after start time")
    row = Prenotazione(**p.model_dump(), user_id=user.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.delete("/api/lavanderia/{item_id}")
def elimina_prenotazione(item_id: int, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("lavanderia"))):
    row = db.query(Prenotazione).filter(Prenotazione.id == item_id, Prenotazione.user_id == user.id).first()
    if not row:
        raise HTTPException(404, "Booking not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ---------- 2. CESTO BIANCHERIA ----------

@app.get("/api/bucato", response_model=list[CapoBucatoOut])
def lista_bucato(db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("lavanderia"))):
    return db.query(CapoBucato).filter(CapoBucato.user_id == user.id).order_by(CapoBucato.created_at).all()


@app.post("/api/bucato", response_model=CapoBucatoOut)
def aggiungi_capo(c: CapoBucatoIn, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("lavanderia"))):
    if c.temperatura not in (30, 40, 60):
        raise HTTPException(400, "Invalid temperature")
    row = CapoBucato(**c.model_dump(), user_id=user.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.patch("/api/bucato/{item_id}", response_model=CapoBucatoOut)
def modifica_capo(item_id: int, dati: CapoBucatoUpdateIn, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("lavanderia"))):
    row = db.query(CapoBucato).filter(CapoBucato.id == item_id, CapoBucato.user_id == user.id).first()
    if not row:
        raise HTTPException(404, "Clothing item not found")
    if dati.nome is not None:
        row.nome = dati.nome
    if dati.temperatura is not None:
        if dati.temperatura not in (30, 40, 60):
            raise HTTPException(400, "Invalid temperature")
        row.temperatura = dati.temperatura
    db.commit()
    db.refresh(row)
    return row


@app.delete("/api/bucato/{item_id}")
def elimina_capo(item_id: int, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("lavanderia"))):
    row = db.query(CapoBucato).filter(CapoBucato.id == item_id, CapoBucato.user_id == user.id).first()
    if not row:
        raise HTTPException(404, "Clothing item not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


@app.post("/api/bucato/lava/{temperatura}")
def fai_lavatrice(temperatura: int, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("lavanderia"))):
    if temperatura not in (30, 40, 60):
        raise HTTPException(400, "Invalid temperature")
    db.query(CapoBucato).filter(CapoBucato.temperatura == temperatura, CapoBucato.user_id == user.id).delete()
    db.commit()
    return {"ok": True}


# ---------- 3. STANZA & PULIZIE (IGIENE) ----------

def assicura_tipi_igiene(db: Session, user_id: int) -> list[IgieneTipo]:
    tipi = db.query(IgieneTipo).filter(IgieneTipo.user_id == user_id).order_by(IgieneTipo.id).all()
    if tipi:
        return tipi
    tipi = [IgieneTipo(user_id=user_id, tipo=tipo, target_giorni=target) for tipo, target in IGIENE_TIPI_DEFAULT.items()]
    db.add_all(tipi)
    db.commit()
    return db.query(IgieneTipo).filter(IgieneTipo.user_id == user_id).order_by(IgieneTipo.id).all()


def calcola_stato_igiene(db: Session, user_id: int, tipo: str, target: int) -> IgieneStatoOut:
    ultima = (
        db.query(IgieneLog)
        .filter(IgieneLog.user_id == user_id, IgieneLog.tipo == tipo)
        .order_by(IgieneLog.data.desc())
        .first()
    )
    if not ultima:
        return IgieneStatoOut(ultima_data=None, giorni_rimanenti=None, scaduto=False, target_giorni=target)
    giorni_passati = (date.today() - ultima.data).days
    giorni_rimanenti = target - giorni_passati
    return IgieneStatoOut(
        ultima_data=ultima.data,
        giorni_rimanenti=giorni_rimanenti,
        scaduto=giorni_rimanenti < 0,
        target_giorni=target,
    )


@app.get("/api/igiene", response_model=dict[str, IgieneStatoOut])
def stato_igiene(db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("stanza"))):
    tipi = assicura_tipi_igiene(db, user.id)
    return {t.tipo: calcola_stato_igiene(db, user.id, t.tipo, t.target_giorni) for t in tipi}


@app.get("/api/igiene/tipi", response_model=list[IgieneTipoOut])
def lista_tipi_igiene(db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("stanza"))):
    return assicura_tipi_igiene(db, user.id)


@app.post("/api/igiene/tipi", response_model=IgieneTipoOut)
def crea_tipo_igiene(dati: IgieneTipoIn, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("stanza"))):
    assicura_tipi_igiene(db, user.id)
    tipo = dati.tipo.strip()
    if not tipo:
        raise HTTPException(400, "Invalid name")
    if dati.target_giorni < 1:
        raise HTTPException(400, "Invalid target days")
    if db.query(IgieneTipo).filter(IgieneTipo.user_id == user.id, IgieneTipo.tipo == tipo).first():
        raise HTTPException(400, "Reminder already exists")
    row = IgieneTipo(user_id=user.id, tipo=tipo, target_giorni=dati.target_giorni)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.post("/api/igiene/{tipo}", response_model=dict[str, IgieneStatoOut])
def registra_igiene(tipo: str, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("stanza"))):
    tipi = assicura_tipi_igiene(db, user.id)
    if tipo not in {t.tipo for t in tipi}:
        raise HTTPException(400, "Invalid type")
    row = IgieneLog(user_id=user.id, tipo=tipo, data=date.today())
    db.add(row)
    db.commit()
    return {t.tipo: calcola_stato_igiene(db, user.id, t.tipo, t.target_giorni) for t in tipi}


@app.put("/api/igiene/tipi/{tipo}", response_model=IgieneTipoOut)
def modifica_tipo_igiene(tipo: str, dati: IgieneTipoUpdateIn, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("stanza"))):
    assicura_tipi_igiene(db, user.id)
    row = db.query(IgieneTipo).filter(IgieneTipo.user_id == user.id, IgieneTipo.tipo == tipo).first()
    if not row:
        raise HTTPException(404, "Reminder not found")
    if dati.target_giorni < 1:
        raise HTTPException(400, "Invalid target days")
    row.target_giorni = dati.target_giorni
    db.commit()
    db.refresh(row)
    return row


@app.delete("/api/igiene/tipi/{tipo}")
def elimina_tipo_igiene(tipo: str, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("stanza"))):
    assicura_tipi_igiene(db, user.id)
    row = db.query(IgieneTipo).filter(IgieneTipo.user_id == user.id, IgieneTipo.tipo == tipo).first()
    if not row:
        raise HTTPException(404, "Reminder not found")
    db.query(IgieneLog).filter(IgieneLog.user_id == user.id, IgieneLog.tipo == tipo).delete()
    db.delete(row)
    db.commit()
    return {"ok": True}


# ---------- 4. DISPENSA & FRIGO ----------

@app.get("/api/frigo", response_model=list[AlimentoFrigoOut])
def lista_frigo(db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("dispensa"))):
    return (
        db.query(AlimentoFrigo)
        .filter(AlimentoFrigo.user_id == user.id)
        .order_by(AlimentoFrigo.scadenza.is_(None), AlimentoFrigo.scadenza)
        .all()
    )


@app.post("/api/frigo", response_model=AlimentoFrigoOut)
def aggiungi_alimento(a: AlimentoFrigoIn, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("dispensa"))):
    row = AlimentoFrigo(**a.model_dump(), user_id=user.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.patch("/api/frigo/{item_id}", response_model=AlimentoFrigoOut)
def modifica_alimento(item_id: int, dati: AlimentoFrigoUpdateIn, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("dispensa"))):
    row = db.query(AlimentoFrigo).filter(AlimentoFrigo.id == item_id, AlimentoFrigo.user_id == user.id).first()
    if not row:
        raise HTTPException(404, "Food item not found")
    if dati.nome is not None:
        row.nome = dati.nome
    if dati.quantita is not None:
        row.quantita = dati.quantita
    db.commit()
    db.refresh(row)
    return row


@app.delete("/api/frigo/{item_id}")
def elimina_alimento(item_id: int, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("dispensa"))):
    row = db.query(AlimentoFrigo).filter(AlimentoFrigo.id == item_id, AlimentoFrigo.user_id == user.id).first()
    if not row:
        raise HTTPException(404, "Food item not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


@app.get("/api/prodotti/{barcode}", response_model=ProdottoOut)
def leggi_prodotto(barcode: str, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("dispensa"))):
    prodotto = db.query(Prodotto).filter(Prodotto.barcode == barcode).first()
    if not prodotto:
        raise HTTPException(404, "Product not found")
    return prodotto


@app.post("/api/prodotti", response_model=ProdottoOut)
def crea_prodotto(p: ProdottoIn, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("dispensa"))):
    prodotto = db.query(Prodotto).filter(Prodotto.barcode == p.barcode).first()
    if prodotto:
        for campo, valore in p.model_dump().items():
            setattr(prodotto, campo, valore)
    else:
        prodotto = Prodotto(**p.model_dump())
        db.add(prodotto)
    db.commit()
    db.refresh(prodotto)
    return prodotto


@app.post("/api/prodotti/{barcode}/scan", response_model=AlimentoFrigoOut)
def scansiona_prodotto(barcode: str, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("dispensa"))):
    prodotto = db.query(Prodotto).filter(Prodotto.barcode == barcode).first()
    if not prodotto:
        raise HTTPException(404, "Product not found")
    scadenza = (
        date.today() + timedelta(days=prodotto.scadenza_giorni_default)
        if prodotto.scadenza_giorni_default is not None
        else None
    )
    row = AlimentoFrigo(
        nome=prodotto.nome,
        quantita=prodotto.quantita_default,
        luogo=prodotto.luogo_default,
        scadenza=scadenza,
        user_id=user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


# ---------- Lista della spesa (dentro Dispensa & Frigo) ----------

@app.get("/api/spesa", response_model=list[SpesaItemOut])
def lista_spesa(db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("dispensa"))):
    return db.query(SpesaItem).filter(SpesaItem.user_id == user.id).order_by(SpesaItem.id).all()


@app.post("/api/spesa", response_model=SpesaItemOut)
def aggiungi_spesa(s: SpesaItemIn, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("dispensa"))):
    row = SpesaItem(nome=s.nome, quantita=s.quantita, comprato=False, user_id=user.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.patch("/api/spesa/{item_id}", response_model=SpesaItemOut)
def toggle_spesa(item_id: int, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("dispensa"))):
    row = db.query(SpesaItem).filter(SpesaItem.id == item_id, SpesaItem.user_id == user.id).first()
    if not row:
        raise HTTPException(404, "Item not found")
    row.comprato = not row.comprato
    db.commit()
    db.refresh(row)
    return row


@app.put("/api/spesa/{item_id}", response_model=SpesaItemOut)
def modifica_spesa(item_id: int, dati: SpesaItemUpdateIn, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("dispensa"))):
    row = db.query(SpesaItem).filter(SpesaItem.id == item_id, SpesaItem.user_id == user.id).first()
    if not row:
        raise HTTPException(404, "Item not found")
    if dati.nome is not None:
        row.nome = dati.nome
    if dati.quantita is not None:
        row.quantita = dati.quantita
    db.commit()
    db.refresh(row)
    return row


@app.delete("/api/spesa/{item_id}")
def elimina_spesa(item_id: int, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("dispensa"))):
    row = db.query(SpesaItem).filter(SpesaItem.id == item_id, SpesaItem.user_id == user.id).first()
    if not row:
        raise HTTPException(404, "Item not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ---------- Ricette (dentro Dispensa & Frigo) ----------

def serializza_ricetta(r: Recipe, owner_username: str, user_id: int) -> RecipeOut:
    return RecipeOut(
        id=r.id, title=r.title, content=r.content, is_shared=r.is_shared,
        owner_username=owner_username, is_mine=(r.user_id == user_id),
    )


@app.get("/api/recipes", response_model=list[RecipeOut])
def lista_ricette(db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("dispensa"))):
    rows = (
        db.query(Recipe)
        .filter((Recipe.user_id == user.id) | (Recipe.is_shared == True))  # noqa: E712
        .order_by(Recipe.created_at.desc())
        .all()
    )
    utenti = {u.id: u.username for u in db.query(User).all()}
    return [serializza_ricetta(r, utenti.get(r.user_id, "?"), user.id) for r in rows]


@app.post("/api/recipes", response_model=RecipeOut)
def crea_ricetta(r: RecipeIn, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("dispensa"))):
    row = Recipe(user_id=user.id, title=r.title, content=r.content, is_shared=r.is_shared)
    db.add(row)
    db.commit()
    db.refresh(row)
    return serializza_ricetta(row, user.username, user.id)


@app.put("/api/recipes/{recipe_id}", response_model=RecipeOut)
def modifica_ricetta(recipe_id: int, dati: RecipeUpdateIn, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("dispensa"))):
    row = db.query(Recipe).filter(Recipe.id == recipe_id, Recipe.user_id == user.id).first()
    if not row:
        raise HTTPException(404, "Recipe not found")
    if dati.title is not None:
        row.title = dati.title
    if dati.content is not None:
        row.content = dati.content
    if dati.is_shared is not None:
        row.is_shared = dati.is_shared
    db.commit()
    db.refresh(row)
    return serializza_ricetta(row, user.username, user.id)


@app.delete("/api/recipes/{recipe_id}")
def elimina_ricetta(recipe_id: int, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("dispensa"))):
    row = db.query(Recipe).filter(Recipe.id == recipe_id, Recipe.user_id == user.id).first()
    if not row:
        raise HTTPException(404, "Recipe not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ---------- 6. FINANZA & SPESE ----------

@app.get("/api/spese", response_model=list[ExpenseOut])
def lista_spese(da: Optional[date] = None, a: Optional[date] = None, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("finanza"))):
    query = db.query(Expense).filter(Expense.user_id == user.id)
    if da:
        query = query.filter(Expense.data >= da)
    if a:
        query = query.filter(Expense.data <= a)
    return query.order_by(Expense.data.desc()).all()


@app.post("/api/spese", response_model=ExpenseOut)
def crea_spesa(e: ExpenseIn, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("finanza"))):
    if e.valuta not in ("NOK", "EUR"):
        raise HTTPException(400, "Invalid currency")
    row = Expense(**e.model_dump(), user_id=user.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.patch("/api/spese/{item_id}", response_model=ExpenseOut)
def modifica_spesa(item_id: int, dati: ExpenseUpdateIn, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("finanza"))):
    row = db.query(Expense).filter(Expense.id == item_id, Expense.user_id == user.id).first()
    if not row:
        raise HTTPException(404, "Expense not found")
    aggiornamenti = dati.model_dump(exclude_unset=True)
    for campo, valore in aggiornamenti.items():
        setattr(row, campo, valore)
    db.commit()
    db.refresh(row)
    return row


@app.delete("/api/spese/{item_id}")
def elimina_spesa_finanza(item_id: int, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("finanza"))):
    row = db.query(Expense).filter(Expense.id == item_id, Expense.user_id == user.id).first()
    if not row:
        raise HTTPException(404, "Expense not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ---------- 7. BUCKET LIST CONDIVISA (non isolata per utente) ----------

@app.get("/api/bucketlist", response_model=list[BucketItemOut])
def lista_bucketlist(db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("bucketlist"))):
    return db.query(SharedBucketListItem).order_by(SharedBucketListItem.created_at).all()


@app.post("/api/bucketlist", response_model=BucketItemOut)
def crea_bucketlist_item(item: BucketItemIn, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("bucketlist"))):
    row = SharedBucketListItem(text=item.text, is_completed=False)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.patch("/api/bucketlist/{item_id}", response_model=BucketItemOut)
def toggle_bucketlist_item(item_id: int, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("bucketlist"))):
    row = db.query(SharedBucketListItem).get(item_id)
    if not row:
        raise HTTPException(404, "Item not found")
    row.is_completed = not row.is_completed
    db.commit()
    db.refresh(row)
    return row


@app.delete("/api/bucketlist/{item_id}")
def elimina_bucketlist_item(item_id: int, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("bucketlist"))):
    row = db.query(SharedBucketListItem).get(item_id)
    if not row:
        raise HTTPException(404, "Item not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ---------- 8. KANBAN (personale) ----------

STATI_KANBAN = {"todo", "doing", "done"}


@app.get("/api/kanban", response_model=list[KanbanTaskOut])
def lista_kanban(db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("kanban"))):
    return db.query(KanbanTask).filter(KanbanTask.user_id == user.id).order_by(KanbanTask.created_at).all()


@app.post("/api/kanban", response_model=KanbanTaskOut)
def crea_kanban_task(t: KanbanTaskIn, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("kanban"))):
    row = KanbanTask(user_id=user.id, title=t.title, description=t.description, status="todo")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.put("/api/kanban/{task_id}", response_model=KanbanTaskOut)
def aggiorna_stato_kanban(task_id: int, dati: KanbanTaskStatusIn, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("kanban"))):
    if dati.status not in STATI_KANBAN:
        raise HTTPException(400, "Invalid status")
    row = db.query(KanbanTask).filter(KanbanTask.id == task_id, KanbanTask.user_id == user.id).first()
    if not row:
        raise HTTPException(404, "Task not found")
    row.status = dati.status
    db.commit()
    db.refresh(row)
    return row


@app.patch("/api/kanban/{task_id}", response_model=KanbanTaskOut)
def modifica_kanban_task(task_id: int, dati: KanbanTaskUpdateIn, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("kanban"))):
    row = db.query(KanbanTask).filter(KanbanTask.id == task_id, KanbanTask.user_id == user.id).first()
    if not row:
        raise HTTPException(404, "Task not found")
    if dati.title is not None:
        row.title = dati.title
    if dati.description is not None:
        row.description = dati.description
    db.commit()
    db.refresh(row)
    return row


@app.delete("/api/kanban/{task_id}")
def elimina_kanban_task(task_id: int, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("kanban"))):
    row = db.query(KanbanTask).filter(KanbanTask.id == task_id, KanbanTask.user_id == user.id).first()
    if not row:
        raise HTTPException(404, "Task not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ---------- Todo list (dentro Kanban) ----------

@app.get("/api/todo", response_model=list[TodoItemOut])
def lista_todo(db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("kanban"))):
    return db.query(TodoItem).filter(TodoItem.user_id == user.id).order_by(TodoItem.id).all()


@app.post("/api/todo", response_model=TodoItemOut)
def aggiungi_todo(t: TodoItemIn, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("kanban"))):
    row = TodoItem(testo=t.testo, fatto=False, user_id=user.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.patch("/api/todo/{item_id}", response_model=TodoItemOut)
def toggle_todo(item_id: int, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("kanban"))):
    row = db.query(TodoItem).filter(TodoItem.id == item_id, TodoItem.user_id == user.id).first()
    if not row:
        raise HTTPException(404, "Entry not found")
    row.fatto = not row.fatto
    db.commit()
    db.refresh(row)
    return row


@app.delete("/api/todo/{item_id}")
def elimina_todo(item_id: int, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("kanban"))):
    row = db.query(TodoItem).filter(TodoItem.id == item_id, TodoItem.user_id == user.id).first()
    if not row:
        raise HTTPException(404, "Entry not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ---------- 9. SEGNALIBRI & RISORSE ----------

@app.get("/api/bookmarks", response_model=list[BookmarkOut])
def lista_bookmark(db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("bookmark"))):
    return db.query(Bookmark).filter(Bookmark.user_id == user.id).order_by(Bookmark.category, Bookmark.title).all()


@app.post("/api/bookmarks", response_model=BookmarkOut)
def crea_bookmark(b: BookmarkIn, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("bookmark"))):
    row = Bookmark(**b.model_dump(), user_id=user.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.delete("/api/bookmarks/{item_id}")
def elimina_bookmark(item_id: int, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("bookmark"))):
    row = db.query(Bookmark).filter(Bookmark.id == item_id, Bookmark.user_id == user.id).first()
    if not row:
        raise HTTPException(404, "Bookmark not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ---------- 10. CUCINA & MEAL PLAN ----------

@app.get("/api/mealplan", response_model=list[MealPlanOut])
def lista_mealplan(da: Optional[date] = None, a: Optional[date] = None, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("mealplan"))):
    query = db.query(MealPlan).filter(MealPlan.user_id == user.id)
    if da:
        query = query.filter(MealPlan.data >= da)
    if a:
        query = query.filter(MealPlan.data <= a)
    return query.order_by(MealPlan.data).all()


@app.post("/api/mealplan", response_model=MealPlanOut)
def salva_mealplan(m: MealPlanIn, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("mealplan"))):
    if m.meal_type not in ("Pranzo", "Cena"):
        raise HTTPException(400, "Invalid meal type")
    row = db.query(MealPlan).filter(
        MealPlan.user_id == user.id, MealPlan.data == m.data, MealPlan.meal_type == m.meal_type
    ).first()
    if row:
        row.recipe = m.recipe
    else:
        row = MealPlan(**m.model_dump(), user_id=user.id)
        db.add(row)
    db.commit()
    db.refresh(row)
    return row


@app.delete("/api/mealplan/{item_id}")
def elimina_mealplan(item_id: int, db: Session = Depends(get_db), user: User = Depends(richiedi_modulo("mealplan"))):
    row = db.query(MealPlan).filter(MealPlan.id == item_id, MealPlan.user_id == user.id).first()
    if not row:
        raise HTTPException(404, "Entry not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ---------- STATIC FILES ----------

class NoCacheStaticFiles(StaticFiles):
    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-cache"
        return response


app.mount("/static", NoCacheStaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/")
def serve_index():
    return FileResponse(BASE_DIR / "static" / "index.html", headers={"Cache-Control": "no-cache"})
