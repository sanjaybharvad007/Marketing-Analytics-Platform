"""Fixtures for tests that need a real PostgreSQL database.

Set TEST_DATABASE_URL to a database that may be wiped: every test session
drops and recreates its `public` schema.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import date

import psycopg
import pytest

from map_pipelines.config import REPO_ROOT, Settings
from map_pipelines.db import Database
from map_pipelines.demo.world import DemoWorld
from map_pipelines.migrate import apply_migrations

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
MIGRATIONS = REPO_ROOT / "db" / "migrations"
ANCHOR = date(2026, 6, 1)


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    skip = pytest.mark.skip(reason="TEST_DATABASE_URL is not set")
    for item in items:
        if "integration" in item.keywords and not TEST_DATABASE_URL:
            item.add_marker(skip)


def reset_schema(url: str) -> None:
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute("DROP SCHEMA IF EXISTS public CASCADE")
        conn.execute("CREATE SCHEMA public")


@pytest.fixture(scope="session")
def database_url() -> str:
    if not TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL is not set")
    return TEST_DATABASE_URL


@pytest.fixture(scope="module")
def db(database_url: str) -> Iterator[Database]:
    """A freshly migrated database, shared by the tests of one module."""
    reset_schema(database_url)
    with psycopg.connect(database_url) as conn:
        apply_migrations(conn, MIGRATIONS)
    database = Database(database_url, max_size=2)
    yield database
    database.close()


@pytest.fixture(scope="module")
def settings(database_url: str) -> Settings:
    return Settings(_env_file=None, database_url=database_url, demo_anchor_date=ANCHOR)


@pytest.fixture(scope="module")
def world(settings: Settings) -> DemoWorld:
    return DemoWorld(settings.demo_seed, ANCHOR, settings.site_url)
