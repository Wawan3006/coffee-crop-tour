"""
database.py — SQLAlchemy engine/session setup.

Reads DATABASE_URL from the environment (see .env.example). Supports:
  - PostgreSQL (production):  postgresql+psycopg2://user:pass@host:5432/dbname
  - SQLite (local dev/testing, zero setup): sqlite:///./coffee_crop_tour_dev.db

PostGIS (Step 11) note: when DATABASE_URL points at a real PostgreSQL server
with the PostGIS extension enabled (`CREATE EXTENSION postgis;`), the
`latitude`/`longitude` columns in models.py can be supplemented with a
`geography(Point, 4326)` column for spatial queries (distance, containment,
clustering). SQLite has no PostGIS equivalent, so spatial helpers in
analytics/validate_gps.py use plain haversine math instead, which works
identically on both backends.
"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except Exception:
    pass  # python-dotenv is optional; env vars can be set another way

DATABASE_URL = os.environ.get("DATABASE_URL") or "sqlite:///./coffee_crop_tour_dev.db"

connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
Base = declarative_base()


def get_db():
    """FastAPI dependency: yields a DB session, always closed after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Create all tables if they don't exist yet (idempotent). Real deployments
    should use a proper migration tool (Alembic) instead of relying on this
    for schema changes after go-live, but this is sufficient to stand the
    system up and for local/dev/test environments."""
    import models  # noqa: F401  (ensures models are registered on Base before create_all)
    Base.metadata.create_all(bind=engine)
