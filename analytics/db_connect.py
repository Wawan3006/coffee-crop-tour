"""
db_connect.py -- shared DB connection helper for the analytics scripts, so
they can be run standalone (cron/scheduled job) against the same database
the backend API writes to, per Step 28's target architecture:

    Database -> Python Validation -> GPS Validation -> Production Calculation
             -> Regional Aggregation -> Power BI Reporting Tables

Reads the same DATABASE_URL env var the backend uses (see backend/.env.example).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402


def get_engine():
    database_url = os.environ.get("DATABASE_URL") or "sqlite:///../backend/coffee_crop_tour_dev.db"
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    return create_engine(database_url, connect_args=connect_args, future=True)


def get_session():
    engine = get_engine()
    Session = sessionmaker(bind=engine, future=True)
    return Session()
