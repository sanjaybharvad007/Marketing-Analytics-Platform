"""Run pipelines: bookkeeping in pipeline_runs, chunked loads, retries, rollup refresh."""

from __future__ import annotations

import time
from collections.abc import Sequence
from dataclasses import dataclass

from map_pipelines.config import Settings
from map_pipelines.db import Database
from map_pipelines.demo.world import DemoWorld
from map_pipelines.etl import load
from map_pipelines.etl.pipelines import (
    Pipeline,
    build_pipeline,
    demo_world,
    ensure_demo_reference_data,
)
from map_pipelines.logs import get_logger
from map_pipelines.models import DateWindow, Mode, PipelineName
from map_pipelines.retry import with_retry

log = get_logger("etl.runner")

# Days loaded per transaction. Bounds memory on long backfills.
CHUNK_DAYS = 14
_FACT_TABLE = {
    "ga4": "ga_daily",
    "gsc": "gsc_daily",
    "seo": "keyword_rankings",
    "ai_visibility": "ai_visibility_results",
}


@dataclass(frozen=True)
class RunOutcome:
    pipeline: PipelineName
    status: str
    rows_loaded: int
    rows_rejected: int
    seconds: float
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.status == "success"


def _start_run(db: Database, pipeline: PipelineName, mode: Mode, window: DateWindow) -> int:
    with db.connection() as conn:
        row = conn.execute(
            """
            INSERT INTO pipeline_runs (pipeline, mode, status, window_start, window_end)
            VALUES (%s, %s, 'running', %s, %s)
            RETURNING id
            """,
            (pipeline, mode, window.start, window.end),
        ).fetchone()
    assert row is not None
    return int(row[0])


def _finish_run(db: Database, run_id: int, status: str, rows: int, error: str | None) -> None:
    with db.connection() as conn:
        conn.execute(
            """
            UPDATE pipeline_runs
            SET status = %s, finished_at = now(), rows_loaded = %s, error = %s
            WHERE id = %s
            """,
            (status, rows, error, run_id),
        )


def run_pipeline(
    db: Database,
    pipeline: Pipeline,
    mode: Mode,
    window: DateWindow,
    *,
    chunk_days: int = CHUNK_DAYS,
) -> RunOutcome:
    """Run one pipeline over `window` and record the outcome.

    Never raises for pipeline failures: the error is stored on the run row and
    returned in the outcome so the caller decides whether to continue.
    """
    started = time.monotonic()
    run_id = _start_run(db, pipeline.name, mode, window)
    log.info(
        "pipeline started",
        extra={"pipeline": pipeline.name, "mode": mode, "from": window.start, "to": window.end},
    )
    loaded = rejected = 0
    try:
        for chunk in window.chunks(chunk_days):

            def load_chunk(chunk: DateWindow = chunk) -> tuple[int, int]:
                with db.connection() as conn:
                    result = pipeline.load_window(conn, chunk)
                return result.rows_loaded, result.rows_rejected

            rows, bad = with_retry(load_chunk, description=f"{pipeline.name} load")
            loaded += rows
            rejected += bad
        with db.connection() as conn:
            conn.execute(f"ANALYZE {_FACT_TABLE[pipeline.name]}")
            load.refresh_rollups(conn, pipeline.rollups)
    except Exception as error:
        seconds = time.monotonic() - started
        message = f"{type(error).__name__}: {error}"
        _finish_run(db, run_id, "failed", loaded, message[:2000])
        log.error(
            "pipeline failed",
            extra={"pipeline": pipeline.name, "error": message, "seconds": round(seconds, 1)},
        )
        return RunOutcome(pipeline.name, "failed", loaded, rejected, seconds, message)

    seconds = time.monotonic() - started
    _finish_run(db, run_id, "success", loaded, None)
    log.info(
        "pipeline finished",
        extra={
            "pipeline": pipeline.name,
            "rows": loaded,
            "rejected": rejected,
            "seconds": round(seconds, 1),
        },
    )
    return RunOutcome(pipeline.name, "success", loaded, rejected, seconds)


def run_many(
    db: Database,
    names: Sequence[PipelineName],
    mode: Mode,
    window: DateWindow,
    settings: Settings,
    *,
    fail_fast: bool = False,
    world: DemoWorld | None = None,
) -> list[RunOutcome]:
    """Run several pipelines in order.

    A pipeline that cannot be built (missing credentials) or fails while
    running is recorded as failed; the rest still run unless `fail_fast`.
    """
    if mode == "demo":
        world = world or demo_world(settings)
        with db.connection() as conn:
            ensure_demo_reference_data(conn, world, settings)

    outcomes: list[RunOutcome] = []
    for name in names:
        try:
            with db.connection() as conn:
                pipeline = build_pipeline(name, mode, settings, conn, world)
        except Exception as error:
            message = f"{type(error).__name__}: {error}"
            run_id = _start_run(db, name, mode, window)
            _finish_run(db, run_id, "failed", 0, message[:2000])
            log.error("pipeline not started", extra={"pipeline": name, "error": message})
            outcome = RunOutcome(name, "failed", 0, 0, 0.0, message)
        else:
            outcome = run_pipeline(db, pipeline, mode, window)
        outcomes.append(outcome)
        if fail_fast and not outcome.ok:
            break
    return outcomes
