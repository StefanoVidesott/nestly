# Modulo Pulizie (chore rotation) — Design

Data: 2026-09-12

## Obiettivo

Nuovo modulo `pulizie`, stesso pattern degli altri moduli dell'app (`MODULI` in
`main.py`, gate via `richiedi_modulo`, visibilità lato utente via
`allowed_modules`). Gestisce una rotazione settimanale delle pulizie tra un
sottoinsieme di utenti scelto dall'admin (roommate), con richieste di swap tra
roommate specifici e statistiche di base.

Non-goal: non gestisce più "task" di pulizia diversi (es. bagno vs cucina) —
una sola rotazione, un turno a settimana. Non invia notifiche push/email:
le richieste di swap si vedono solo dentro l'app.

## Modello dati

```python
class PulizieRoommate(Base):
    __tablename__ = "pulizie_roommate"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("utenti.id"), nullable=False, unique=True, index=True)
    ordine = Column(Integer, nullable=False)  # posizione nella rotazione, univoca

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

`"pulizie"` va aggiunto alla lista `MODULI`.

## Calcolo settimana e rotazione

- Epoca fissa: lunedì 2020-01-06.
- `settimana_idx(d: date) = (d - date(2020, 1, 6)).days // 7`. Monotono,
  deterministico, nessuna tabella da pre-popolare per il futuro.
- Turno di default per una settimana non ancora materializzata:
  `roommate_ordinati[settimana_idx % n_roommate]`, dove `roommate_ordinati`
  è `PulizieRoommate` ordinato per `ordine` con join a `User` corrente.
- **Materializzazione lazy**: una riga `PulizieSettimana` per un dato
  `settimana_idx` viene creata la prima volta che serve (view schedule,
  richiesta swap, marcatura completamento) usando la lista roommate
  *al momento della creazione*. Una volta creata, la riga è la fonte di
  verità per quella settimana e non cambia più per effetto di modifiche
  successive alla lista roommate — solo le settimane non ancora
  materializzate risentono di riordini/aggiunte/rimozioni.
- Se `n_roommate == 0`, lo schedule è vuoto e l'app mostra un messaggio
  "nessun roommate configurato" invece di errore 500.

## Swap

Flusso: il roommate assegnato a una settimana (`assegnato_user_id`) chiede a
un **roommate specifico** (`target_id`) di coprire il turno. Non è uno scambio
reciproco di due settimane: il target semplicemente eredita quel turno.

Regole di validazione:
- `settimana_idx` richiesto deve essere corrente o futura (mai passata).
- Il chiamante deve essere l'attuale `assegnato_user_id` per quella settimana
  (la riga viene materializzata se non esiste ancora, poi si valida).
- La settimana non deve essere già `completato = True`.
- `target_id` deve essere un roommate attivo in `PulizieRoommate`, diverso dal
  richiedente.
- Non può esistere già una richiesta `in_attesa` per la stessa
  `settimana_idx` (una alla volta; il richiedente deve annullarla per
  crearne un'altra).

Transizioni di stato:
- `POST /pulizie/swap` → crea riga `stato=in_attesa`.
- `POST /pulizie/swap/{id}/annulla` → solo il richiedente, solo se
  `in_attesa` → `annullata`.
- `POST /pulizie/swap/{id}/rifiuta` → solo il target, solo se `in_attesa`
  → `rifiutata`.
- `POST /pulizie/swap/{id}/accetta` → solo il target, solo se `in_attesa`.
  Dentro una transazione: ricontrolla che `PulizieSettimana.assegnato_user_id`
  sia ancora il richiedente originale (evita race condition con un'altra
  accettazione o completamento nel frattempo); se sì, imposta
  `assegnato_user_id = target_id` e `stato = accettata`; se no, ritorna 409
  e lascia la richiesta in_attesa per essere annullata manualmente.

## Completamento

`POST /pulizie/settimane/{settimana_idx}/completa` — solo l'attuale
`assegnato_user_id` (dopo eventuale swap) può marcare fatto. Idempotente:
richiamarlo su una settimana già completata non fa nulla (200, nessun
cambiamento).

## Statistiche

`GET /pulizie/stats` ritorna, per ogni roommate attivo:
- `turni_assegnati_totali` (righe `PulizieSettimana` storiche, incluse quelle
  ereditate da swap accettati)
- `turni_completati`
- `swap_richiesti` (come richiedente)
- `swap_accettati_dati` (richieste create da lui, accettate da altri)
- `swap_accettati_ricevuti` (richieste accettate da lui come target)

Calcolate on-the-fly con query di aggregazione, nessuna tabella derivata.

## Endpoint

Tutti sotto `richiedi_modulo("pulizie")` salvo dove indicato:

- `GET /pulizie/roommate` — lista roommate + ordine (vista, qualunque membro)
- `PUT /pulizie/roommate` — **richiedi_admin**, sostituisce la lista
  roommate+ordine (accetta lista di `user_id` nell'ordine desiderato,
  riscrive `PulizieRoommate`)
- `GET /pulizie/settimane?settimane=N` — schedule da oggi per N settimane
  (default 4), materializza on-demand, include eventuali richieste swap
  pendenti per ogni settimana
- `POST /pulizie/settimane/{settimana_idx}/completa`
- `POST /pulizie/swap` — body `{settimana_idx, target_id}`
- `POST /pulizie/swap/{id}/accetta`
- `POST /pulizie/swap/{id}/rifiuta`
- `POST /pulizie/swap/{id}/annulla`
- `GET /pulizie/swap/mie` — richieste in_attesa dove l'utente è richiedente o
  target (per la UI "in arrivo" / "inviate")
- `GET /pulizie/stats`

## Frontend

Nuova sezione stile esistente (stesso pattern delle altre, card +
Tailwind), aggiunta a `MODULI`/sidebar:

- Card "questa settimana": chi tocca, bottone "Segna fatto" (visibile solo
  all'assegnato), bottone "Chiedi swap" (select roommate + invio).
- Lista prossime settimane (sola lettura).
- Sezione "Richieste swap": in arrivo (accetta/rifiuta) e inviate
  (annulla), entrambe da `GET /pulizie/swap/mie`.
- Sezione admin (solo se `role == admin`): gestione lista roommate e
  ordine (drag o frecce su/giù, semplice).
- Sezione statistiche: tabella/cards con le 5 metriche per roommate.

## Errori

Convenzione esistente: `HTTPException` con status 400/403/404/409 e
messaggio in italiano, coerente con gli altri endpoint di `main.py`.
