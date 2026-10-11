"""PostgreSQL access: a small connection pool and the COPY-then-merge staging helper."""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Sequence
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg import sql
from psycopg_pool import ConnectionPool

Row = Sequence[Any]


class Database:
    """Thin wrapper around a psycopg connection pool."""

    def __init__(self, url: str, *, max_size: int = 4) -> None:
        self._pool = ConnectionPool(
            conninfo=url,
            min_size=1,
            max_size=max_size,
            open=False,
            kwargs={"autocommit": False},
        )
        self._pool.open(wait=True, timeout=15)

    @contextmanager
    def connection(self) -> Iterator[psycopg.Connection]:
        """Yield a connection; commit on success, roll back on error."""
        with self._pool.connection() as conn:
            yield conn

    def close(self) -> None:
        self._pool.close()

    def __enter__(self) -> Database:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


def stage_rows(
    conn: psycopg.Connection,
    name: str,
    columns: Sequence[tuple[str, str]],
    rows: Iterable[Row],
) -> int:
    """COPY `rows` into a transaction-scoped temp table and return the row count.

    `columns` is a list of (column name, SQL type). The table is dropped at
    commit, so each load stages and merges inside one transaction.
    """
    table = sql.Identifier(name)
    column_defs = sql.SQL(", ").join(
        sql.SQL("{} {}").format(sql.Identifier(col), sql.SQL(sql_type)) for col, sql_type in columns
    )
    column_names = sql.SQL(", ").join(sql.Identifier(col) for col, _ in columns)
    count = 0
    with conn.cursor() as cur:
        cur.execute(sql.SQL("DROP TABLE IF EXISTS {}").format(table))
        cur.execute(sql.SQL("CREATE TEMP TABLE {} ({}) ON COMMIT DROP").format(table, column_defs))
        copy_sql = sql.SQL("COPY {} ({}) FROM STDIN").format(table, column_names)
        with cur.copy(copy_sql) as copy:
            for row in rows:
                copy.write_row(row)
                count += 1
        # Temp tables have no statistics until analysed; the merge joins need them.
        cur.execute(sql.SQL("ANALYZE {}").format(table))
    return count


def execute_count(conn: psycopg.Connection, statement: str, params: Sequence[Any] = ()) -> int:
    """Execute a statement and return the number of affected rows."""
    with conn.cursor() as cur:
        cur.execute(statement, params)
        return max(cur.rowcount, 0)


def fetch_all(
    conn: psycopg.Connection, statement: str, params: Sequence[Any] = ()
) -> list[tuple[Any, ...]]:
    with conn.cursor() as cur:
        cur.execute(statement, params)
        return cur.fetchall()
