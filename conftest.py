"""Shared pytest configuration for the TraceAI repository.

Tests run against an in-memory SQLite database and a temporary evidence
directory so they are fast, hermetic, and never touch the database or storage
configured in the developer's ``.env`` file.
"""

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# Make the backend application and SDK importable regardless of how pytest is
# invoked, before any application module is imported.
for _path in (ROOT / "backend", ROOT / "sdk"):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))

# These must be set before importing the application settings and database.
os.environ["DATABASE_URL"] = "sqlite+pysqlite://"
os.environ["LOCAL_STORAGE_DIR"] = tempfile.mkdtemp(prefix="traceai-test-evidence-")
# Never write test evidence to a configured cloud bucket.
os.environ["SUPABASE_URL"] = ""
os.environ["SUPABASE_KEY"] = ""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import models  # noqa: F401 - registers all ORM models on Base.metadata
from app.db.database import Base, get_db
from app.main import app


@pytest.fixture()
def db_engine():
    """Create a fresh in-memory database for each test."""
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    try:
        yield engine
    finally:
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture()
def db_sessionmaker(db_engine):
    """Session factory bound to the per-test database."""
    return sessionmaker(
        bind=db_engine,
        autoflush=False,
        autocommit=False,
    )


@pytest.fixture(autouse=True)
def isolated_database(monkeypatch, db_sessionmaker):
    """Point the application at the per-test database for this test."""
    import app.db.database as database_module

    # Tests that call ``get_db()`` directly (instead of through FastAPI) use
    # the module-level SessionLocal, so patch it as well.
    monkeypatch.setattr(database_module, "SessionLocal", db_sessionmaker)

    def override_get_db():
        db = db_sessionmaker()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield
    finally:
        app.dependency_overrides.clear()


@pytest.fixture()
def client(isolated_database):
    """TestClient bound to the isolated database."""
    return TestClient(app)
