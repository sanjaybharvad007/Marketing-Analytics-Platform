"""The four pipelines: which source feeds which transform, load and rollups."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Protocol

import psycopg

from map_pipelines.config import Settings
from map_pipelines.db import fetch_all
from map_pipelines.demo import catalog
from map_pipelines.demo.ai import PromptRef
from map_pipelines.demo.world import DemoWorld
from map_pipelines.etl import load, transforms
from map_pipelines.etl.transforms import TransformContext
from map_pipelines.models import DateWindow, Mode, PageRecord, PipelineName
from map_pipelines.sources.ai_visibility import (
    AiVisibilityDemoSource,
    AiVisibilityLiveSource,
    build_engines,
)
from map_pipelines.sources.base import RawRow, Source
from map_pipelines.sources.ga4 import Ga4DemoSource, Ga4LiveSource
from map_pipelines.sources.gsc import GscDemoSource, GscLiveSource
from map_pipelines.sources.mentions import TrackedBrand
from map_pipelines.sources.seo_csv import SeoCsvSource, SeoDemoSource, resolve_mapping
from map_pipelines.transform.classify import BrandClassifier

PIPELINE_ORDER: tuple[PipelineName, ...] = ("ga4", "gsc", "seo", "ai_visibility")


@dataclass(frozen=True)
class LoadResult:
    rows_loaded: int
    rows_rejected: int = 0


class Pipeline(Protocol):
    name: PipelineName
    rollups: tuple[str, ...]

    def load_window(self, conn: psycopg.Connection, window: DateWindow) -> LoadResult: ...


def _pages_for(urls: Iterable[str], ctx: TransformContext) -> list[PageRecord]:
    return [transforms.page_record(url, ctx) for url in dict.fromkeys(urls)]


@dataclass
class Ga4Pipeline:
    source: Source
    ctx: TransformContext
    name: PipelineName = "ga4"
    rollups: tuple[str, ...] = ("mv_traffic_daily",)

    def load_window(self, conn: psycopg.Connection, window: DateWindow) -> LoadResult:
        records, rejected = transforms.to_ga_records(self.source.fetch(window), self.ctx)
        load.upsert_pages(conn, _pages_for((r.url for r in records), self.ctx))
        return LoadResult(load.load_ga(conn, records), rejected)


@dataclass
class GscPipeline:
    source: Source
    ctx: TransformContext
    name: PipelineName = "gsc"
    rollups: tuple[str, ...] = ("mv_search_page_daily",)

    def load_window(self, conn: psycopg.Connection, window: DateWindow) -> LoadResult:
        records, rejected = transforms.to_gsc_records(self.source.fetch(window), self.ctx)
        load.upsert_pages(conn, _pages_for((r.url for r in records), self.ctx))
        return LoadResult(load.load_gsc(conn, records), rejected)


class SeoSource(Source, Protocol):
    """An SEO source also reports domain-level authority metrics."""

    def fetch_domain_metrics(self, window: DateWindow) -> Iterable[RawRow]: ...


@dataclass
class SeoPipeline:
    source: SeoSource
    ctx: TransformContext
    name: PipelineName = "seo"
    rollups: tuple[str, ...] = ()

    def load_window(self, conn: psycopg.Connection, window: DateWindow) -> LoadResult:
        rankings, rejected = transforms.to_keyword_records(self.source.fetch(window), self.ctx)
        load.upsert_pages(conn, _pages_for((r.url for r in rankings if r.url), self.ctx))
        loaded = load.load_keyword_rankings(conn, rankings)
        domains, rejected_domains = transforms.to_domain_records(
            self.source.fetch_domain_metrics(window)
        )
        loaded += load.load_domain_metrics(conn, domains)
        return LoadResult(loaded, rejected + rejected_domains)


@dataclass
class AiVisibilityPipeline:
    source: Source
    brand: TrackedBrand
    competitors: tuple[TrackedBrand, ...]
    name: PipelineName = "ai_visibility"
    rollups: tuple[str, ...] = ("mv_ai_visibility_daily",)

    def load_window(self, conn: psycopg.Connection, window: DateWindow) -> LoadResult:
        records, rejected = transforms.to_ai_records(
            self.source.fetch(window), self.brand, self.competitors
        )
        return LoadResult(load.load_ai_results(conn, records), rejected)


# --- construction -----------------------------------------------------------


def demo_anchor(settings: Settings, today: date | None = None) -> date:
    """The day after the newest demo data: DEMO_ANCHOR_DATE, or today."""
    return settings.demo_anchor_date or today or date.today()


def demo_world(settings: Settings, today: date | None = None) -> DemoWorld:
    return DemoWorld(settings.demo_seed, demo_anchor(settings, today), settings.site_url)


def transform_context(settings: Settings) -> TransformContext:
    return TransformContext(
        site_url=settings.site_url,
        brand=BrandClassifier(settings.brand_query_pattern),
    )


def tracked_brands(settings: Settings) -> tuple[TrackedBrand, tuple[TrackedBrand, ...]]:
    terms = settings.brand_terms
    brand = TrackedBrand(
        name=settings.brand_name,
        domain=settings.site_host,
        aliases=tuple(term for term in terms if term != settings.brand_name),
    )
    competitors = tuple(
        TrackedBrand(name=competitor.name, domain=competitor.domain)
        for competitor in settings.competitor_list
    )
    return brand, competitors


def demo_page_records(world: DemoWorld, ctx: TransformContext) -> list[PageRecord]:
    """Catalogue pages with the metadata a crawl would normally provide."""
    records: list[PageRecord] = []
    for page in world.pages:
        base = transforms.page_record(world.url(page), ctx)
        published = datetime.combine(world.published_on(page), time(9, 0), tzinfo=UTC)
        records.append(
            base.model_copy(
                update={
                    "title": page.title,
                    "word_count": page.word_count,
                    "published_at": published,
                }
            )
        )
    return records


def ensure_demo_reference_data(
    conn: psycopg.Connection, world: DemoWorld, settings: Settings
) -> None:
    """Demo runs need the catalogue pages and the tracked prompts to exist."""
    load.upsert_pages(conn, demo_page_records(world, transform_context(settings)))
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO ai_prompts (prompt, topic, intent) VALUES (%s, %s, %s)
            ON CONFLICT (prompt) DO NOTHING
            """,
            [(p.prompt, p.topic, p.intent) for p in catalog.AI_PROMPTS],
        )


def active_prompts(conn: psycopg.Connection) -> list[PromptRef]:
    rows = fetch_all(conn, "SELECT id, prompt, topic FROM ai_prompts WHERE active ORDER BY id")
    return [PromptRef(id=row[0], prompt=row[1], topic=row[2]) for row in rows]


def build_pipeline(
    name: PipelineName,
    mode: Mode,
    settings: Settings,
    conn: psycopg.Connection,
    world: DemoWorld | None = None,
) -> Pipeline:
    """Create one pipeline with its demo or live source.

    Raises SourceNotConfigured when a live source lacks its settings.
    """
    ctx = transform_context(settings)
    if mode == "demo":
        world = world or demo_world(settings)
    if name == "ga4":
        source: Source = Ga4DemoSource(world) if world else Ga4LiveSource(settings.ga4_property_id)
        return Ga4Pipeline(source, ctx)
    if name == "gsc":
        source = GscDemoSource(world) if world else GscLiveSource(settings.gsc_site_url)
        return GscPipeline(source, ctx)
    if name == "seo":
        seo_source: SeoSource = (
            SeoDemoSource(world)
            if world
            else SeoCsvSource(
                settings.seo_export_dir,
                resolve_mapping(settings.seo_csv_preset),
                settings.site_host,
            )
        )
        return SeoPipeline(seo_source, ctx)
    brand, competitors = tracked_brands(settings)
    prompts = active_prompts(conn)
    ai_source: Source = (
        AiVisibilityDemoSource(world, prompts)
        if world
        else AiVisibilityLiveSource(build_engines(settings), prompts)
    )
    return AiVisibilityPipeline(ai_source, brand, competitors)


def default_window(
    days: int, mode: Mode, settings: Settings, today: date | None = None
) -> DateWindow:
    """The trailing `days` ending yesterday (demo: the day before the anchor)."""
    reference = demo_anchor(settings, today) if mode == "demo" else (today or date.today())
    return DateWindow.trailing(days, reference - timedelta(days=1))
