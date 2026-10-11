"""Loads against a real database: idempotence, pruning, rollups, run bookkeeping."""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import pytest

from map_pipelines.config import Settings
from map_pipelines.db import Database, fetch_all
from map_pipelines.demo.world import DemoWorld
from map_pipelines.etl.pipelines import (
    PIPELINE_ORDER,
    SeoPipeline,
    build_pipeline,
    transform_context,
)
from map_pipelines.etl.runner import run_many, run_pipeline
from map_pipelines.models import DateWindow
from map_pipelines.sources.seo_csv import PRESETS, SeoRowsSource, decode_export, read_keyword_csv

from .conftest import ANCHOR

pytestmark = pytest.mark.integration

WINDOW = DateWindow(start=ANCHOR - timedelta(days=5), end=ANCHOR - timedelta(days=1))
FACT_TABLES = (
    "pages",
    "ga_daily",
    "gsc_daily",
    "keywords",
    "keyword_rankings",
    "domain_metrics_daily",
    "ai_prompts",
    "ai_visibility_results",
    "mv_traffic_daily",
    "mv_search_page_daily",
    "mv_ai_visibility_daily",
)
FIXTURES = Path(__file__).parent.parent / "fixtures"


def counts(db: Database) -> dict[str, int]:
    with db.connection() as conn:
        return {
            table: fetch_all(conn, f"SELECT count(*) FROM {table}")[0][0] for table in FACT_TABLES
        }


def scalar(db: Database, statement: str, params: tuple = ()):
    with db.connection() as conn:
        return fetch_all(conn, statement, params)[0][0]


@pytest.fixture(scope="module")
def loaded(db: Database, settings: Settings, world: DemoWorld) -> dict[str, int]:
    outcomes = run_many(db, list(PIPELINE_ORDER), "demo", WINDOW, settings, world=world)
    assert [outcome.status for outcome in outcomes] == ["success"] * 4
    assert all(outcome.rows_rejected == 0 for outcome in outcomes)
    return counts(db)


def test_first_load_populates_every_table(loaded: dict[str, int]) -> None:
    assert loaded["pages"] == 60
    assert loaded["ai_prompts"] == 40
    assert loaded["ai_visibility_results"] == 5 * 40 * 5
    assert loaded["keyword_rankings"] == 5 * 160
    assert loaded["domain_metrics_daily"] == 5 * 4
    assert loaded["ga_daily"] > 5_000
    assert loaded["gsc_daily"] > 10_000
    assert all(count > 0 for count in loaded.values())


def test_rerunning_the_window_changes_nothing(
    db: Database, settings: Settings, world: DemoWorld, loaded: dict[str, int]
) -> None:
    sums_before = scalar(
        db, "SELECT (sum(clicks), sum(impressions), sum(sum_position))::text FROM gsc_daily"
    )
    outcomes = run_many(db, list(PIPELINE_ORDER), "demo", WINDOW, settings, world=world)
    assert all(outcome.ok for outcome in outcomes)
    assert counts(db) == loaded
    sums_after = scalar(
        db, "SELECT (sum(clicks), sum(impressions), sum(sum_position))::text FROM gsc_daily"
    )
    assert sums_after == sums_before


def test_overlapping_window_adds_only_the_new_days(
    db: Database, settings: Settings, world: DemoWorld, loaded: dict[str, int]
) -> None:
    wider = DateWindow(start=WINDOW.start - timedelta(days=2), end=WINDOW.end)
    run_many(db, ["seo", "ai_visibility"], "demo", wider, settings, world=world)
    after = counts(db)
    assert after["keyword_rankings"] == loaded["keyword_rankings"] + 2 * 160
    assert after["ai_visibility_results"] == loaded["ai_visibility_results"] + 2 * 200
    assert after["keywords"] == loaded["keywords"]


def test_traffic_rollup_matches_the_base_table(db: Database, loaded: dict[str, int]) -> None:
    base = scalar(
        db, "SELECT (sum(sessions), sum(users), sum(conversions), sum(revenue))::text FROM ga_daily"
    )
    rollup = scalar(
        db,
        "SELECT (sum(sessions), sum(users), sum(conversions), sum(revenue))::text FROM mv_traffic_daily",
    )
    assert rollup == base


def test_search_rollup_matches_the_base_table(db: Database, loaded: dict[str, int]) -> None:
    mismatches = scalar(
        db,
        """
        SELECT count(*) FROM (
            SELECT date, page_id, country, device, is_brand,
                   sum(clicks) AS clicks, sum(impressions) AS impressions, sum(sum_position) AS sp
            FROM gsc_daily GROUP BY 1, 2, 3, 4, 5
        ) base
        FULL JOIN mv_search_page_daily mv USING (date, page_id, country, device, is_brand)
        WHERE base.clicks IS DISTINCT FROM mv.clicks
           OR base.impressions IS DISTINCT FROM mv.impressions
           OR abs(base.sp - mv.sum_position) > 1e-6
           OR base.sp IS NULL OR mv.sum_position IS NULL
        """,
    )
    assert mismatches == 0


def test_ai_rollup_matches_the_base_table(db: Database, loaded: dict[str, int]) -> None:
    base = scalar(
        db,
        "SELECT (count(*), count(*) FILTER (WHERE brand_mentioned), count(*) FILTER (WHERE cited))::text "
        "FROM ai_visibility_results",
    )
    rollup = scalar(
        db, "SELECT (sum(checks), sum(mentioned), sum(cited))::text FROM mv_ai_visibility_daily"
    )
    assert rollup == base
    ranked = scalar(
        db,
        "SELECT sum(rank_1 + rank_2 + rank_3 + rank_4_plus) = sum(mentioned) FROM mv_ai_visibility_daily",
    )
    assert ranked is True


def test_average_position_aggregates_from_the_weighted_sum(
    db: Database, loaded: dict[str, int]
) -> None:
    position = scalar(db, "SELECT sum(sum_position) / sum(impressions) FROM gsc_daily")
    assert 1 < position < 30


def test_rows_the_source_no_longer_reports_are_pruned(
    db: Database, settings: Settings, world: DemoWorld, loaded: dict[str, int]
) -> None:
    day = WINDOW.end
    with db.connection() as conn:
        page_id = fetch_all(conn, "SELECT id FROM pages WHERE path = '/'")[0][0]
        conn.execute(
            "INSERT INTO gsc_daily (date, page_id, query, country, device, clicks, impressions, sum_position) "
            "VALUES (%s, %s, 'stale query that vanished', 'US', 'mobile', 1, 10, 50)",
            (day, page_id),
        )
        conn.execute(
            "INSERT INTO ga_daily (date, page_id, channel, device, country, sessions, users, "
            "engaged_sessions, conversions) VALUES (%s, %s, 'Stale Channel', 'mobile', 'US', 5, 5, 1, 0)",
            (day, page_id),
        )
        # A stale row outside the re-pulled window must survive.
        conn.execute(
            "INSERT INTO gsc_daily (date, page_id, query, country, device, clicks, impressions, sum_position) "
            "VALUES (%s, %s, 'old row outside window', 'US', 'mobile', 1, 10, 50)",
            (WINDOW.start - timedelta(days=30), page_id),
        )
    repull = DateWindow(start=day, end=day)
    assert all(o.ok for o in run_many(db, ["ga4", "gsc"], "demo", repull, settings, world=world))
    assert (
        scalar(db, "SELECT count(*) FROM gsc_daily WHERE query = 'stale query that vanished'") == 0
    )
    assert scalar(db, "SELECT count(*) FROM ga_daily WHERE channel = 'Stale Channel'") == 0
    assert scalar(db, "SELECT count(*) FROM gsc_daily WHERE query = 'old row outside window'") == 1
    assert scalar(db, "SELECT count(*) FROM ga_daily") == loaded["ga_daily"]


def test_runs_are_recorded_with_mode_window_and_row_counts(
    db: Database, loaded: dict[str, int]
) -> None:
    with db.connection() as conn:
        rows = fetch_all(
            conn,
            "SELECT pipeline, mode, status, rows_loaded, window_start, window_end, finished_at "
            "FROM pipeline_runs ORDER BY id LIMIT 4",
        )
    assert [row[0] for row in rows] == ["ga4", "gsc", "seo", "ai_visibility"]
    assert all(row[1] == "demo" and row[2] == "success" for row in rows)
    assert rows[0][3] == loaded["ga_daily"]
    assert (rows[0][4], rows[0][5]) == (WINDOW.start, WINDOW.end)
    assert all(row[6] is not None for row in rows)


def test_a_failing_pipeline_records_its_error_and_the_rest_continue(
    db: Database, settings: Settings, loaded: dict[str, int]
) -> None:
    """Live mode without credentials: every pipeline fails to start, none blocks the others."""
    live = settings.model_copy(update={"seo_export_dir": Path("/nonexistent/exports")})
    outcomes = run_many(db, list(PIPELINE_ORDER), "live", WINDOW, live)
    assert [outcome.status for outcome in outcomes] == ["failed"] * 4
    assert "GA4_PROPERTY_ID" in outcomes[0].error
    assert "GSC_SITE_URL" in outcomes[1].error
    with db.connection() as conn:
        recorded = fetch_all(
            conn,
            "SELECT pipeline, error FROM pipeline_runs WHERE mode = 'live' AND status = 'failed' ORDER BY id",
        )
    assert [row[0] for row in recorded[-4:]] == list(PIPELINE_ORDER)
    assert all(row[1] for row in recorded)
    assert counts(db)["ga_daily"] == loaded["ga_daily"]


def test_fail_fast_stops_after_the_first_failure(db: Database, settings: Settings) -> None:
    outcomes = run_many(db, list(PIPELINE_ORDER), "live", WINDOW, settings, fail_fast=True)
    assert [outcome.pipeline for outcome in outcomes] == ["ga4"]


def test_a_source_error_mid_run_is_captured(
    db: Database, settings: Settings, world: DemoWorld
) -> None:
    with db.connection() as conn:
        pipeline = build_pipeline("ga4", "demo", settings, conn, world)

    class ExplodingSource:
        name = "ga4"
        mode = "demo"

        def fetch(self, window: DateWindow):
            raise RuntimeError("quota exhausted")

    pipeline.source = ExplodingSource()
    outcome = run_pipeline(db, pipeline, "demo", WINDOW)
    assert outcome.status == "failed"
    assert outcome.error == "RuntimeError: quota exhausted"
    assert scalar(db, "SELECT error FROM pipeline_runs ORDER BY id DESC LIMIT 1") == outcome.error


def test_csv_export_loads_through_the_seo_pipeline(db: Database, settings: Settings) -> None:
    text = decode_export((FIXTURES / "semrush_positions_2026-05-30.csv").read_bytes())
    rows = list(read_keyword_csv(text, PRESETS["semrush"], date(2026, 5, 30)))
    window = DateWindow(start=date(2026, 5, 30), end=date(2026, 5, 30))
    pipeline = SeoPipeline(SeoRowsSource(rows), transform_context(settings))

    first = run_pipeline(db, pipeline, "live", window)
    assert first.ok
    assert first.rows_loaded == 6
    again = run_pipeline(db, pipeline, "live", window)
    assert again.ok

    with db.connection() as conn:
        (stored,) = fetch_all(
            conn,
            """
            SELECT k.search_volume, k.difficulty, k.intent, r.position, p.path, r.serp_features
            FROM keywords k
            JOIN keyword_rankings r ON r.keyword_id = k.id AND r.date = %s
            LEFT JOIN pages p ON p.id = r.page_id
            WHERE k.keyword = 'backpacking tents'
            """,
            (date(2026, 5, 30),),
        )
    # The export's values replace the demo values for the same keyword and day.
    assert stored == (
        22200,
        62,
        "commercial",
        14,
        "/categories/tents/",
        ["people_also_ask", "ai_overview", "image_pack"],
    )
    imported = scalar(
        db,
        "SELECT count(*) FROM keyword_rankings r JOIN keywords k ON k.id = r.keyword_id "
        "WHERE r.date = %s AND k.keyword = ANY(%s)",
        (date(2026, 5, 30), [row["keyword"] for row in rows]),
    )
    assert imported == 6
