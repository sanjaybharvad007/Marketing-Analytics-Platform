"""Runtime configuration, read from environment variables and an optional .env file."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PACKAGE_ROOT = Path(__file__).resolve().parent
PIPELINES_ROOT = PACKAGE_ROOT.parents[1]
REPO_ROOT = PIPELINES_ROOT.parent

LLMProviderName = Literal["offline", "anthropic", "openai"]


@dataclass(frozen=True)
class Competitor:
    name: str
    domain: str


class Settings(BaseSettings):
    """Every option can be set through the environment; see .env.example."""

    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgres://postgres:postgres@localhost:5432/marketing"
    migrations_dir: Path = REPO_ROOT / "db" / "migrations"
    log_format: Literal["console", "json"] = "console"
    log_level: str = "INFO"

    # The tracked site and how to recognise it.
    site_url: str = "https://www.northpeak.example"
    brand_name: str = "Northpeak Outfitters"
    brand_aliases: str = "Northpeak"
    brand_query_pattern: str = r"north\s*-?\s*peak|northpeek|nrthpeak"
    competitors: str = (
        "Summit & Co=summitandco.example,TrailForge=trailforge.example,Alpenway=alpenway.example"
    )

    # Demo mode.
    demo_seed: int = 20260101
    demo_anchor_date: date | None = None

    # GA4 Data API.
    ga4_property_id: str = ""
    google_application_credentials: str = ""

    # Search Console.
    gsc_site_url: str = ""

    # SEO tool exports.
    seo_export_dir: Path = PIPELINES_ROOT / "exports"
    seo_csv_preset: str = "semrush"

    # Platform REST API, used by the audit, brief, opportunity and digest scripts.
    api_base_url: str = "http://localhost:3000"
    api_token: str = ""

    # LLM used for summaries, briefs and the digest narrative.
    llm_provider: LLMProviderName = "offline"
    llm_timeout_seconds: float = 60.0
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5-5"
    anthropic_base_url: str = "https://api.anthropic.com"
    openai_api_key: str = ""
    openai_model: str = ""
    openai_base_url: str = "https://api.openai.com/v1"

    # Answer engines queried by the live AI-visibility connector. An engine is
    # enabled when its API key and model are both set.
    ai_engine_chatgpt_api_key: str = ""
    ai_engine_chatgpt_model: str = ""
    ai_engine_chatgpt_base_url: str = "https://api.openai.com/v1"
    ai_engine_perplexity_api_key: str = ""
    ai_engine_perplexity_model: str = ""
    ai_engine_perplexity_base_url: str = "https://api.perplexity.ai"
    ai_engine_gemini_api_key: str = ""
    ai_engine_gemini_model: str = ""
    ai_engine_gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    ai_engine_claude_api_key: str = ""
    ai_engine_claude_model: str = ""

    digest_output_dir: Path = Field(default=PIPELINES_ROOT / "reports")

    @field_validator("site_url")
    @classmethod
    def _strip_trailing_slash(cls, value: str) -> str:
        return value.rstrip("/")

    @field_validator("brand_query_pattern")
    @classmethod
    def _valid_regex(cls, value: str) -> str:
        re.compile(value)
        return value

    @property
    def site_host(self) -> str:
        return urlsplit(self.site_url).hostname or ""

    @property
    def brand_terms(self) -> list[str]:
        """Brand name plus aliases, longest first so the full name matches before a prefix."""
        aliases = [alias.strip() for alias in self.brand_aliases.split(",") if alias.strip()]
        terms = dict.fromkeys([self.brand_name, *aliases])
        return sorted(terms, key=len, reverse=True)

    @property
    def competitor_list(self) -> list[Competitor]:
        parsed: list[Competitor] = []
        for chunk in self.competitors.split(","):
            if not chunk.strip():
                continue
            name, _, domain = chunk.partition("=")
            parsed.append(Competitor(name=name.strip(), domain=domain.strip().lower()))
        return parsed


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
