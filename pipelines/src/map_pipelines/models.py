"""Validated records exchanged between the extract, transform and load steps."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Mode = Literal["demo", "live"]
PipelineName = Literal["ga4", "gsc", "seo", "ai_visibility"]
Device = Literal["desktop", "mobile", "tablet"]
Intent = Literal["informational", "commercial", "transactional", "navigational"]
Engine = Literal["chatgpt", "perplexity", "gemini", "google_ai_overviews", "claude"]
Sentiment = Literal["positive", "neutral", "negative"]
PageType = Literal["home", "landing", "category", "product", "article", "guide", "store", "other"]

ENGINES: tuple[Engine, ...] = ("chatgpt", "perplexity", "gemini", "google_ai_overviews", "claude")
ENGINE_LABELS: dict[str, str] = {
    "chatgpt": "ChatGPT",
    "perplexity": "Perplexity",
    "gemini": "Gemini",
    "google_ai_overviews": "Google AI Overviews",
    "claude": "Claude",
}


class Record(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class DateWindow(Record):
    """Inclusive date range."""

    start: date
    end: date

    @model_validator(mode="after")
    def _ordered(self) -> DateWindow:
        if self.end < self.start:
            raise ValueError("window end is before its start")
        return self

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    def dates(self) -> list[date]:
        return [self.start + timedelta(days=offset) for offset in range(self.days)]

    def chunks(self, size: int) -> list[DateWindow]:
        """Split into consecutive windows of at most `size` days."""
        if size < 1:
            raise ValueError("chunk size must be at least 1")
        pieces: list[DateWindow] = []
        start = self.start
        while start <= self.end:
            end = min(start + timedelta(days=size - 1), self.end)
            pieces.append(DateWindow(start=start, end=end))
            start = end + timedelta(days=1)
        return pieces

    @classmethod
    def trailing(cls, days: int, end: date) -> DateWindow:
        if days < 1:
            raise ValueError("days must be at least 1")
        return cls(start=end - timedelta(days=days - 1), end=end)


class PageRecord(Record):
    url: str
    path: str
    section: str
    page_type: PageType
    title: str | None = None
    word_count: int | None = Field(default=None, ge=0)
    published_at: datetime | None = None


class GaRecord(Record):
    date: date
    url: str
    channel: str = Field(min_length=1)
    device: Device
    country: str = Field(pattern=r"^[A-Z]{2}$")
    sessions: int = Field(ge=0)
    users: int = Field(ge=0)
    engaged_sessions: int = Field(ge=0)
    conversions: int = Field(ge=0)
    revenue: Decimal = Field(ge=0, max_digits=12, decimal_places=2)


class GscRecord(Record):
    date: date
    url: str
    query: str = Field(min_length=1, max_length=1000)
    country: str = Field(pattern=r"^[A-Z]{2}$")
    device: Device
    clicks: int = Field(ge=0)
    impressions: int = Field(ge=0)
    # Average position multiplied by impressions, so it sums across rows.
    sum_position: float = Field(ge=0)
    is_brand: bool = False

    @model_validator(mode="after")
    def _clicks_within_impressions(self) -> GscRecord:
        if self.clicks > self.impressions:
            raise ValueError("clicks exceed impressions")
        return self


class KeywordRankingRecord(Record):
    date: date
    keyword: str = Field(min_length=1, max_length=500)
    url: str | None = None
    position: int | None = Field(default=None, ge=1, le=100)
    search_volume: int = Field(default=0, ge=0)
    difficulty: int | None = Field(default=None, ge=0, le=100)
    intent: Intent = "informational"
    cpc: Decimal | None = Field(default=None, ge=0, max_digits=8, decimal_places=2)
    serp_features: tuple[str, ...] = ()


class DomainMetricRecord(Record):
    date: date
    domain: str = Field(min_length=3)
    is_own: bool = False
    authority_score: int = Field(ge=0, le=100)
    referring_domains: int = Field(ge=0)
    backlinks: int = Field(ge=0)


class AiResultRecord(Record):
    date: date
    prompt_id: int
    engine: Engine
    brand_mentioned: bool
    brand_rank: int | None = Field(default=None, ge=1)
    cited: bool = False
    cited_url: str | None = None
    sentiment: Sentiment | None = None
    competitors_mentioned: tuple[str, ...] = ()
    answer_excerpt: str = ""

    @model_validator(mode="after")
    def _consistent(self) -> AiResultRecord:
        if not self.brand_mentioned and self.brand_rank is not None:
            raise ValueError("brand_rank set although the brand is not mentioned")
        if not self.cited and self.cited_url is not None:
            raise ValueError("cited_url set although the brand is not cited")
        return self
