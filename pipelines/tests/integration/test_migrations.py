from __future__ import annotations

import shutil
from pathlib import Path

import psycopg
import pytest

from map_pipelines.migrate import MigrationError, apply_migrations, discover

from .conftest import MIGRATIONS, reset_schema

pytestmark = pytest.mark.integration

EXPECTED_TABLES = {
    "schema_migrations",
    "pages",
    "members",
    "pipeline_runs",
    "ga_daily",
    "gsc_daily",
    "keywords",
    "keyword_rankings",
    "domain_metrics_daily",
    "ai_prompts",
    "ai_visibility_results",
    "content_plans",
    "tasks",
    "audit_runs",
    "audit_issues",
    "saved_views",
}
EXPECTED_VIEWS = {"mv_traffic_daily", "mv_search_page_daily", "mv_ai_visibility_daily"}


def test_migrations_apply_cleanly_from_an_empty_database(database_url: str) -> None:
    reset_schema(database_url)
    with psycopg.connect(database_url) as conn:
        applied = apply_migrations(conn, MIGRATIONS)
        assert applied == [migration.version for migration in discover(MIGRATIONS)]
        tables = {
            row[0]
            for row in conn.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
        }
        views = {
            row[0]
            for row in conn.execute(
                "SELECT matviewname FROM pg_matviews WHERE schemaname = 'public'"
            )
        }
    assert tables == EXPECTED_TABLES
    assert views == EXPECTED_VIEWS


def test_reapplying_is_a_no_op(database_url: str) -> None:
    with psycopg.connect(database_url) as conn:
        apply_migrations(conn, MIGRATIONS)
        assert apply_migrations(conn, MIGRATIONS) == []
        recorded = conn.execute("SELECT count(*) FROM schema_migrations").fetchone()[0]
    assert recorded == len(discover(MIGRATIONS))


def test_every_rollup_can_be_refreshed_concurrently(database_url: str) -> None:
    with psycopg.connect(database_url, autocommit=True) as conn:
        apply_migrations(conn, MIGRATIONS)
        for view in EXPECTED_VIEWS:
            conn.execute(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {view}")


def test_editing_an_applied_migration_is_detected(database_url: str, tmp_path: Path) -> None:
    copy = tmp_path / "migrations"
    shutil.copytree(MIGRATIONS, copy)
    with psycopg.connect(database_url) as conn:
        apply_migrations(conn, copy)
        first = sorted(copy.glob("*.sql"))[0]
        first.write_text(first.read_text() + "\n-- edited\n")
        with pytest.raises(MigrationError, match="modified after it was applied"):
            apply_migrations(conn, copy)


def test_a_failing_migration_rolls_back_and_is_not_recorded(
    database_url: str, tmp_path: Path
) -> None:
    copy = tmp_path / "migrations"
    shutil.copytree(MIGRATIONS, copy)
    (copy / "9999_broken.sql").write_text("CREATE TABLE half_done (id integer); SELECT 1 / 0;")
    with psycopg.connect(database_url) as conn:
        apply_migrations(conn, MIGRATIONS)
        with pytest.raises(MigrationError, match="9999_broken"):
            apply_migrations(conn, copy)
        assert conn.execute("SELECT to_regclass('public.half_done')").fetchone()[0] is None
        versions = {row[0] for row in conn.execute("SELECT version FROM schema_migrations")}
    assert "9999_broken" not in versions


def test_constraints_reject_bad_rows(database_url: str) -> None:
    with psycopg.connect(database_url) as conn:
        apply_migrations(conn, MIGRATIONS)
        conn.commit()
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute("INSERT INTO tasks (title, status) VALUES ('x', 'doing')")
        conn.rollback()
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute(
                "INSERT INTO members (name, email, role, color) VALUES ('a', 'a@x', 'r', 'blue')"
            )
        conn.rollback()
        conn.execute("INSERT INTO tasks (title, dedupe_key) VALUES ('first', 'k1')")
        with pytest.raises(psycopg.errors.UniqueViolation):
            conn.execute("INSERT INTO tasks (title, dedupe_key) VALUES ('second', 'k1')")
        conn.rollback()
