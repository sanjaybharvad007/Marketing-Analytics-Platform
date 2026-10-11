"""Data structures produced by the crawler and consumed by the rules."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

Severity = Literal["critical", "high", "medium", "low"]


@dataclass(frozen=True)
class Link:
    # Absolute URL in public-origin form, without fragment.
    url: str
    # The href exactly as written in the HTML.
    raw: str
    internal: bool


@dataclass(frozen=True)
class Image:
    src: str
    # None when the alt attribute is absent; "" marks a decorative image.
    alt: str | None


@dataclass(frozen=True)
class Fetch:
    """Outcome of requesting one URL, following redirects by hand."""

    url: str
    status: int
    final_url: str
    # Every URL visited, starting with `url`; length 1 means no redirect.
    chain: tuple[str, ...]
    elapsed_ms: float
    content_type: str = ""
    error: str | None = None

    @property
    def redirects(self) -> int:
        return len(self.chain) - 1

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300


@dataclass
class Page:
    """A fetched HTML document and what was extracted from it."""

    url: str
    fetch: Fetch
    titles: list[str] = field(default_factory=list)
    meta_description: str | None = None
    h1: list[str] = field(default_factory=list)
    canonical: str | None = None
    robots: str = ""
    word_count: int = 0
    images: list[Image] = field(default_factory=list)
    links: list[Link] = field(default_factory=list)
    structured_data_types: list[str] = field(default_factory=list)
    open_graph: dict[str, str] = field(default_factory=dict)

    @property
    def title(self) -> str | None:
        return self.titles[0] if self.titles else None

    @property
    def noindex(self) -> bool:
        return "noindex" in self.robots.lower()


@dataclass
class CrawlResult:
    site_url: str
    pages: dict[str, Page] = field(default_factory=dict)
    # Every internal URL requested, HTML or not, including failures.
    fetches: dict[str, Fetch] = field(default_factory=dict)
    sitemap_urls: set[str] = field(default_factory=set)
    # target URL -> pages that link to it
    inlinks: dict[str, set[str]] = field(default_factory=dict)
    skipped_by_robots: set[str] = field(default_factory=set)


@dataclass(frozen=True)
class Issue:
    rule: str
    severity: Severity
    url: str
    message: str
    details: dict[str, object] = field(default_factory=dict)
