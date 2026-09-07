"""Standalone seed script: ensures the default admin user and starter data exist.

Importing main.py already creates the DB tables and the default admin/admin
user if the database is empty (see crea_admin_default_se_vuoto). This script
additionally seeds default data (e.g. the Room & Cleaning reminders) for every
existing user, which normally happens lazily on first page load but can be
run explicitly right after a fresh deploy.

Usage:
    docker compose exec nestly python seed.py
    # or, without a running container:
    python seed.py
"""

import main as app


def seed():
    db = app.SessionLocal()
    try:
        utenti = db.query(app.User).all()
        print(f"Users in database: {len(utenti)}")
        for u in utenti:
            tipi = app.assicura_tipi_igiene(db, u.id)
            nomi = ", ".join(t.tipo for t in tipi)
            print(f"  - {u.username} ({u.role}): reminders = {nomi}")
    finally:
        db.close()
    print("Seed complete.")


if __name__ == "__main__":
    seed()
