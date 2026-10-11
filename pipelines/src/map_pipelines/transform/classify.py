"""Classify pages into a section and page type from path rules, and queries into brand/non-brand."""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

PageType = Literal["home", "landing", "category", "product", "article", "guide", "store", "other"]


@dataclass(frozen=True)
class PathRule:
    """First matching rule wins, so order rules from most to least specific."""

    pattern: str
    section: str
    page_type: PageType

    def matches(self, path: str) -> bool:
        return re.search(self.pattern, path) is not None


DEFAULT_PATH_RULES: tuple[PathRule, ...] = (
    PathRule(r"^/$", "landing", "home"),
    PathRule(r"^/blog/$", "blog", "landing"),
    PathRule(r"^/blog/.+", "blog", "article"),
    PathRule(r"^/guides/$", "guides", "landing"),
    PathRule(r"^/guides/.+", "guides", "guide"),
    PathRule(r"^/products/$", "products", "category"),
    PathRule(r"^/products/.+", "products", "product"),
    PathRule(r"^/categories/.*", "categories", "category"),
    PathRule(r"^/stores/$", "stores", "landing"),
    PathRule(r"^/stores/.+", "stores", "store"),
    PathRule(r"^/[^/]+/$", "landing", "landing"),
)


@dataclass(frozen=True)
class PageClass:
    section: str
    page_type: PageType


def classify_path(path: str, rules: Sequence[PathRule] = DEFAULT_PATH_RULES) -> PageClass:
    """Return the section and page type of a normalised path."""
    bare = path.split("?", 1)[0]
    for rule in rules:
        if rule.matches(bare):
            return PageClass(rule.section, rule.page_type)
    return PageClass("other", "other")


class BrandClassifier:
    """Flags search queries that contain the brand, including common misspellings."""

    def __init__(self, pattern: str) -> None:
        self._regex = re.compile(pattern, re.IGNORECASE)

    def is_brand(self, query: str) -> bool:
        return self._regex.search(query) is not None


_TRANSACTIONAL = re.compile(
    r"\b(buy|price|prices|sale|deals?|coupon|discount|clearance|order|near me|shop|store)\b"
)
_COMMERCIAL = re.compile(
    r"\b(best|top|vs|versus|reviews?|compare|comparison|alternatives?|affordable|cheap|"
    r"worth it|under \$?\d+)\b"
)
_INFORMATIONAL_START = re.compile(
    r"^(how|what|why|when|where|who|which|do|does|is|are|can|should)\b"
)
_INFORMATIONAL = re.compile(
    r"\b(guide|tips|ideas|checklist|explained|chart|meaning|principles|list|diy|calculator)\b"
)


def classify_intent(query: str, *, is_brand: bool = False) -> str:
    """Rule-based search intent, used when a source does not supply one."""
    text = query.strip().lower()
    if is_brand:
        return "navigational"
    if _TRANSACTIONAL.search(text):
        return "transactional"
    if _COMMERCIAL.search(text):
        return "commercial"
    if _INFORMATIONAL_START.search(text) or _INFORMATIONAL.search(text):
        return "informational"
    # Short head terms ("hiking boots") are usually product research.
    return "commercial" if len(text.split()) <= 3 else "informational"
