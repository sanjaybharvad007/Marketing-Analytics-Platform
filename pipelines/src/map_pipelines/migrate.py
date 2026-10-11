"""Apply the plain-SQL migrations in db/migrations, tracked in schema_migrations."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

import psycopg

from map_pipelines.logs import get_logger

log = get_logger("migrate")

# Arbitrary constant: serialises concurrent `map migrate` runs.
_ADVISORY_LOCK_KEY = 7_316_042


class MigrationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Migration:
    version: str
    path: Path

    @property
    def sql(self) -> str:
        return self.path.read_text(encoding="utf-8")

    @property
    def checksum(self) -> str:
        return hashlib.sha256(self.path.read_bytes()).hexdigest()


def discover(migrations_dir: Path) -> list[Migration]:
    if not migrations_dir.is_dir():
        raise MigrationError(f"Migrations directory not found: {migrations_dir}")
    migrations = [Migration(version=path.stem, path=path) for path in migrations_dir.glob("*.sql")]
    return sorted(migrations, key=lambda migration: migration.version)


def apply_migrations(conn: psycopg.Connection, migrations_dir: Path) -> list[str]:
    """Apply pending migrations in filename order and return the versions applied.

    Each migration runs in its own transaction. A migration whose file changed
    after it was applied is reported as an error rather than silently ignored.
    """
    migrations = discover(migrations_dir)
    applied_now: list[str] = []

    conn.execute("SELECT pg_advisory_lock(%s)", (_ADVISORY_LOCK_KEY,))
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version    text        PRIMARY KEY,
                checksum   text        NOT NULL,
                applied_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        conn.commit()
        already = dict(conn.execute("SELECT version, checksum FROM schema_migrations").fetchall())
        conn.commit()

        for migration in migrations:
            recorded = already.get(migration.version)
            if recorded is not None:
                if recorded != migration.checksum:
                    raise MigrationError(
                        f"Migration {migration.version} was modified after it was applied. "
                        "Add a new migration instead of editing an applied one."
                    )
                continue
            log.info("applying migration", extra={"version": migration.version})
            try:
                conn.execute(migration.sql.encode("utf-8"))
                conn.execute(
                    "INSERT INTO schema_migrations (version, checksum) VALUES (%s, %s)",
                    (migration.version, migration.checksum),
                )
                conn.commit()
            except psycopg.Error as error:
                conn.rollback()
                raise MigrationError(f"Migration {migration.version} failed: {error}") from error
            applied_now.append(migration.version)
    finally:
        conn.rollback()
        conn.execute("SELECT pg_advisory_unlock(%s)", (_ADVISORY_LOCK_KEY,))
        conn.commit()
    return applied_now
