"""Idempotent loads: COPY into a temp table, then merge with INSERT ... ON CONFLICT.

Fact loads also prune rows for the staged dates that the source no longer
reports, so re-pulling a window leaves exactly what the source returned for
it. Pruning is limited to dates present in the batch; an empty pull never
deletes anything.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence

import psycopg

from map_pipelines.db import execute_count, stage_rows
from map_pipelines.models import (
    AiResultRecord,
    DomainMetricRecord,
    GaRecord,
    GscRecord,
    KeywordRankingRecord,
    PageRecord,
)

ROLLUPS = ("mv_traffic_daily", "mv_search_page_daily", "mv_ai_visibility_daily")


def upsert_pages(conn: psycopg.Connection, pages: Iterable[PageRecord]) -> int:
    """Insert unseen pages and refresh metadata for known ones.

    Metadata a source does not carry (title, word count, publish date) is left
    untouched rather than overwritten with NULL.
    """
    unique = {page.url: page for page in pages}
    stage_rows(
        conn,
        "stage_pages",
        [
            ("url", "text"),
            ("path", "text"),
            ("title", "text"),
            ("section", "text"),
            ("page_type", "text"),
            ("word_count", "integer"),
            ("published_at", "timestamptz"),
        ],
        (
            (p.url, p.path, p.title, p.section, p.page_type, p.word_count, p.published_at)
            for p in unique.values()
        ),
    )
    return execute_count(
        conn,
        """
        INSERT INTO pages (url, path, title, section, page_type, word_count, published_at)
        SELECT url, path, title, section, page_type, word_count, published_at
        FROM stage_pages
        ON CONFLICT (url) DO UPDATE SET
            path = EXCLUDED.path,
            section = EXCLUDED.section,
            page_type = EXCLUDED.page_type,
            title = COALESCE(EXCLUDED.title, pages.title),
            word_count = COALESCE(EXCLUDED.word_count, pages.word_count),
            published_at = COALESCE(EXCLUDED.published_at, pages.published_at),
            last_seen_at = now()
        """,
    )


def load_ga(conn: psycopg.Connection, records: Sequence[GaRecord]) -> int:
    stage_rows(
        conn,
        "stage_ga",
        [
            ("date", "date"),
            ("url", "text"),
            ("channel", "text"),
            ("device", "text"),
            ("country", "char(2)"),
            ("sessions", "integer"),
            ("users", "integer"),
            ("engaged_sessions", "integer"),
            ("conversions", "integer"),
            ("revenue", "numeric(12,2)"),
        ],
        (
            (
                r.date,
                r.url,
                r.channel,
                r.device,
                r.country,
                r.sessions,
                r.users,
                r.engaged_sessions,
                r.conversions,
                r.revenue,
            )
            for r in records
        ),
    )
    loaded = execute_count(
        conn,
        """
        INSERT INTO ga_daily (date, page_id, channel, device, country,
                              sessions, users, engaged_sessions, conversions, revenue)
        SELECT s.date, p.id, s.channel, s.device, s.country,
               s.sessions, s.users, s.engaged_sessions, s.conversions, s.revenue
        FROM stage_ga s
        JOIN pages p ON p.url = s.url
        ON CONFLICT (date, page_id, channel, device, country) DO UPDATE SET
            sessions = EXCLUDED.sessions,
            users = EXCLUDED.users,
            engaged_sessions = EXCLUDED.engaged_sessions,
            conversions = EXCLUDED.conversions,
            revenue = EXCLUDED.revenue,
            loaded_at = now()
        """,
    )
    execute_count(
        conn,
        """
        DELETE FROM ga_daily g
        WHERE g.date IN (SELECT DISTINCT date FROM stage_ga)
          AND NOT EXISTS (
              SELECT 1
              FROM stage_ga s
              JOIN pages p ON p.url = s.url
              WHERE s.date = g.date AND p.id = g.page_id AND s.channel = g.channel
                AND s.device = g.device AND s.country = g.country
          )
        """,
    )
    return loaded


def load_gsc(conn: psycopg.Connection, records: Sequence[GscRecord]) -> int:
    stage_rows(
        conn,
        "stage_gsc",
        [
            ("date", "date"),
            ("url", "text"),
            ("query", "text"),
            ("country", "char(2)"),
            ("device", "text"),
            ("clicks", "integer"),
            ("impressions", "integer"),
            ("sum_position", "double precision"),
            ("is_brand", "boolean"),
        ],
        (
            (
                r.date,
                r.url,
                r.query,
                r.country,
                r.device,
                r.clicks,
                r.impressions,
                r.sum_position,
                r.is_brand,
            )
            for r in records
        ),
    )
    loaded = execute_count(
        conn,
        """
        INSERT INTO gsc_daily (date, page_id, query, country, device,
                               clicks, impressions, sum_position, is_brand)
        SELECT s.date, p.id, s.query, s.country, s.device,
               s.clicks, s.impressions, s.sum_position, s.is_brand
        FROM stage_gsc s
        JOIN pages p ON p.url = s.url
        ON CONFLICT (date, page_id, query, country, device) DO UPDATE SET
            clicks = EXCLUDED.clicks,
            impressions = EXCLUDED.impressions,
            sum_position = EXCLUDED.sum_position,
            is_brand = EXCLUDED.is_brand,
            loaded_at = now()
        """,
    )
    execute_count(
        conn,
        """
        DELETE FROM gsc_daily g
        WHERE g.date IN (SELECT DISTINCT date FROM stage_gsc)
          AND NOT EXISTS (
              SELECT 1
              FROM stage_gsc s
              JOIN pages p ON p.url = s.url
              WHERE s.date = g.date AND s.query = g.query AND p.id = g.page_id
                AND s.country = g.country AND s.device = g.device
          )
        """,
    )
    return loaded


def load_keyword_rankings(conn: psycopg.Connection, records: Sequence[KeywordRankingRecord]) -> int:
    stage_rows(
        conn,
        "stage_rankings",
        [
            ("date", "date"),
            ("keyword", "text"),
            ("url", "text"),
            ("position", "smallint"),
            ("search_volume", "integer"),
            ("difficulty", "smallint"),
            ("intent", "text"),
            ("cpc", "numeric(8,2)"),
            ("serp_features", "text[]"),
        ],
        (
            (
                r.date,
                r.keyword,
                r.url,
                r.position,
                r.search_volume,
                r.difficulty,
                r.intent,
                r.cpc,
                list(r.serp_features),
            )
            for r in records
        ),
    )
    # Keyword attributes come from the newest snapshot in the batch.
    execute_count(
        conn,
        """
        INSERT INTO keywords (keyword, search_volume, difficulty, intent, cpc)
        SELECT DISTINCT ON (keyword) keyword, search_volume, difficulty, intent, cpc
        FROM stage_rankings
        ORDER BY keyword, date DESC
        ON CONFLICT (keyword) DO UPDATE SET
            search_volume = EXCLUDED.search_volume,
            difficulty = COALESCE(EXCLUDED.difficulty, keywords.difficulty),
            intent = EXCLUDED.intent,
            cpc = COALESCE(EXCLUDED.cpc, keywords.cpc),
            updated_at = now()
        """,
    )
    return execute_count(
        conn,
        """
        INSERT INTO keyword_rankings (date, keyword_id, page_id, position, serp_features)
        SELECT s.date, k.id, p.id, s.position, s.serp_features
        FROM stage_rankings s
        JOIN keywords k ON k.keyword = s.keyword
        LEFT JOIN pages p ON p.url = s.url
        ON CONFLICT (date, keyword_id) DO UPDATE SET
            page_id = EXCLUDED.page_id,
            position = EXCLUDED.position,
            serp_features = EXCLUDED.serp_features,
            loaded_at = now()
        """,
    )


def load_domain_metrics(conn: psycopg.Connection, records: Sequence[DomainMetricRecord]) -> int:
    stage_rows(
        conn,
        "stage_domains",
        [
            ("date", "date"),
            ("domain", "text"),
            ("is_own", "boolean"),
            ("authority_score", "smallint"),
            ("referring_domains", "integer"),
            ("backlinks", "integer"),
        ],
        (
            (r.date, r.domain, r.is_own, r.authority_score, r.referring_domains, r.backlinks)
            for r in records
        ),
    )
    return execute_count(
        conn,
        """
        INSERT INTO domain_metrics_daily
            (date, domain, is_own, authority_score, referring_domains, backlinks)
        SELECT date, domain, is_own, authority_score, referring_domains, backlinks
        FROM stage_domains
        ON CONFLICT (date, domain) DO UPDATE SET
            is_own = EXCLUDED.is_own,
            authority_score = EXCLUDED.authority_score,
            referring_domains = EXCLUDED.referring_domains,
            backlinks = EXCLUDED.backlinks,
            loaded_at = now()
        """,
    )


def load_ai_results(conn: psycopg.Connection, records: Sequence[AiResultRecord]) -> int:
    stage_rows(
        conn,
        "stage_ai",
        [
            ("date", "date"),
            ("prompt_id", "integer"),
            ("engine", "text"),
            ("brand_mentioned", "boolean"),
            ("brand_rank", "smallint"),
            ("cited", "boolean"),
            ("cited_url", "text"),
            ("sentiment", "text"),
            ("competitors_mentioned", "text[]"),
            ("answer_excerpt", "text"),
        ],
        (
            (
                r.date,
                r.prompt_id,
                r.engine,
                r.brand_mentioned,
                r.brand_rank,
                r.cited,
                r.cited_url,
                r.sentiment,
                list(r.competitors_mentioned),
                r.answer_excerpt,
            )
            for r in records
        ),
    )
    return execute_count(
        conn,
        """
        INSERT INTO ai_visibility_results
            (date, prompt_id, engine, brand_mentioned, brand_rank, cited, cited_url,
             sentiment, competitors_mentioned, answer_excerpt)
        SELECT date, prompt_id, engine, brand_mentioned, brand_rank, cited, cited_url,
               sentiment, competitors_mentioned, answer_excerpt
        FROM stage_ai
        ON CONFLICT (date, prompt_id, engine) DO UPDATE SET
            brand_mentioned = EXCLUDED.brand_mentioned,
            brand_rank = EXCLUDED.brand_rank,
            cited = EXCLUDED.cited,
            cited_url = EXCLUDED.cited_url,
            sentiment = EXCLUDED.sentiment,
            competitors_mentioned = EXCLUDED.competitors_mentioned,
            answer_excerpt = EXCLUDED.answer_excerpt,
            loaded_at = now()
        """,
    )


def refresh_rollups(conn: psycopg.Connection, views: Iterable[str]) -> None:
    """Refresh materialized views without blocking readers."""
    for view in views:
        if view not in ROLLUPS:
            raise ValueError(f"unknown rollup: {view}")
        conn.execute(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {view}")
