"""The demo "world": the query catalogue and the factors every generator shares.

Values for a given date depend only on (seed, anchor date, entity), never on
the window being generated. The anchor is the day after the newest data and
positions the stories (growth, decay, a product launch) relative to "now".
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta
from functools import cached_property

from map_pipelines.demo import catalog, rng
from map_pipelines.demo.catalog import DemoPage
from map_pipelines.transform.classify import (
    BrandClassifier,
    PageClass,
    classify_intent,
    classify_path,
)

HISTORY_DAYS = 120
_RANK_WEIGHTS = (1.0, 0.55, 0.36, 0.27, 0.21, 0.17, 0.14)
_BASE_DEMAND = 520.0
_WEEKDAY = (1.02, 1.0, 0.98, 0.97, 0.93, 1.05, 1.12)  # Monday .. Sunday
BASE_COUNTRY_SHARE = {"US": 0.50, "CA": 0.14, "GB": 0.15, "DE": 0.08, "AU": 0.13}
_DEVICE_SHARE = {
    "product": {"mobile": 0.52, "desktop": 0.42, "tablet": 0.06},
    "category": {"mobile": 0.52, "desktop": 0.42, "tablet": 0.06},
    "article": {"mobile": 0.62, "desktop": 0.33, "tablet": 0.05},
    "guide": {"mobile": 0.62, "desktop": 0.33, "tablet": 0.05},
    "store": {"mobile": 0.74, "desktop": 0.23, "tablet": 0.03},
    "home": {"mobile": 0.50, "desktop": 0.44, "tablet": 0.06},
    "landing": {"mobile": 0.50, "desktop": 0.44, "tablet": 0.06},
}


@dataclass(frozen=True)
class DemoQuery:
    query: str
    page: DemoPage
    # Expected daily impressions across all markets at full visibility.
    demand: float
    base_position: float
    is_brand: bool
    intent: str
    ctr_factor: float


def expected_ctr(position: float) -> float:
    """Click-through rate by position: roughly 32% at 1, 2.5% at 10, 1.2% at 20."""
    return 0.32 * max(position, 1.0) ** -1.1


def visibility(position: float) -> float:
    """Share of searches in which a result at this position is actually seen."""
    return max(0.06, 1.0 / (1.0 + math.exp((position - 13.0) / 3.5)))


class DemoWorld:
    def __init__(self, seed: int, anchor: date, site_url: str = catalog.SITE_URL) -> None:
        self.seed = seed
        self.anchor = anchor
        self.site_url = site_url.rstrip("/")
        self._brand = BrandClassifier(r"north\s*-?\s*peak|northpeek")

    # --- catalogue --------------------------------------------------------

    @property
    def pages(self) -> tuple[DemoPage, ...]:
        return catalog.ALL_PAGES

    def url(self, page: DemoPage) -> str:
        return f"{self.site_url}{page.path}"

    def page_class(self, page: DemoPage) -> PageClass:
        return classify_path(page.path)

    def published_on(self, page: DemoPage) -> date:
        return self.anchor - timedelta(days=page.age_days)

    def _query_texts(self, page: DemoPage) -> list[str]:
        page_type = self.page_class(page).page_type
        terms = page.terms
        if page_type == "category":
            head, secondary, variant = terms
            return [
                head,
                f"best {head}",
                secondary,
                f"{head} sale",
                variant,
                f"{catalog.BRAND_SHORT} {head}",
            ]
        if page_type == "product":
            name, generic, alternative = terms
            return [
                generic,
                name,
                f"{catalog.BRAND_SHORT} {name}",
                alternative,
                f"{name} review",
            ]
        if page_type == "store":
            (city,) = terms
            return [
                f"northpeak outfitters {city}",
                f"outdoor store {city}",
                f"camping store {city}",
                f"hiking gear {city}",
                f"{city} outdoor gear shop",
            ]
        return list(terms)

    @cached_property
    def queries(self) -> tuple[DemoQuery, ...]:
        seen: set[str] = set()
        built: list[DemoQuery] = []
        for page in self.pages:
            page_type = self.page_class(page).page_type
            for rank, text in enumerate(self._query_texts(page)):
                if text in seen:
                    continue
                seen.add(text)
                is_brand = self._brand.is_brand(text)
                striking = text in catalog.STRIKING_DISTANCE_QUERIES
                weight = _RANK_WEIGHTS[min(rank, len(_RANK_WEIGHTS) - 1)]
                demand = (
                    _BASE_DEMAND * page.weight * weight * rng.noise(self.seed, 0.3, "demand", text)
                )
                if striking:
                    demand *= 2.4
                if is_brand and page_type != "home":
                    # Few people search for the brand plus a product or city.
                    demand *= 0.06
                built.append(
                    DemoQuery(
                        query=text,
                        page=page,
                        demand=demand,
                        base_position=self._base_position(text, page_type, is_brand, striking),
                        is_brand=is_brand,
                        intent=classify_intent(text, is_brand=is_brand),
                        ctr_factor=1.2 if is_brand else (0.45 if striking else 1.0),
                    )
                )
        return tuple(built)

    def _base_position(self, text: str, page_type: str, is_brand: bool, striking: bool) -> float:
        draw = rng.uniform(self.seed, "position", text)
        if is_brand:
            return 1.0 + 0.8 * draw
        if striking:
            return 9.0 + 8.0 * draw
        tier = rng.uniform(self.seed, "tier", text)
        if page_type == "guide":
            tier *= 0.8  # guides are the site's strongest content
        if tier < 0.28:
            return 2.5 + 3.5 * draw
        if tier < 0.58:
            return 6.0 + 5.0 * draw
        if tier < 0.85:
            return 11.0 + 11.0 * draw
        return 22.0 + 16.0 * draw

    @cached_property
    def _queries_by_path(self) -> dict[str, list[DemoQuery]]:
        grouped: dict[str, list[DemoQuery]] = {page.path: [] for page in self.pages}
        for query in self.queries:
            grouped[query.page.path].append(query)
        return grouped

    def queries_for(self, page: DemoPage) -> list[DemoQuery]:
        return self._queries_by_path[page.path]

    # --- shared factors -----------------------------------------------------

    def age(self, day: date) -> int:
        """Days between `day` and the anchor; 1 is the newest day with data."""
        return (self.anchor - day).days

    def weekday_factor(self, day: date) -> float:
        return _WEEKDAY[day.weekday()]

    def trend(self, day: date) -> float:
        """Gentle site-wide growth: about +8% across the 120-day history."""
        progress = 1.0 - min(max(self.age(day), 0), HISTORY_DAYS) / HISTORY_DAYS
        return 0.92 + 0.08 * progress

    def decay_progress(self, page: DemoPage, day: date) -> float:
        """0 before a decaying page started slipping, 1 at the anchor."""
        if page.path not in catalog.DECAYING_PATHS:
            return 0.0
        return min(max((45 - self.age(day)) / 45, 0.0), 1.0)

    def demand_story(self, page: DemoPage, day: date) -> float:
        """Multiplier on organic demand that carries the stories."""
        age = self.age(day)
        if age > page.age_days:
            return 0.0  # not published yet
        factor = 1.0
        if page.age_days < HISTORY_DAYS:
            # Newly launched pages ramp up over their first three weeks.
            factor *= min(1.0, (page.age_days - age + 1) / 21)
        if self.page_class(page).section == catalog.GROWING_SECTION:
            progress = 1.0 - min(age, HISTORY_DAYS) / HISTORY_DAYS
            factor *= 0.6 + 0.4 * progress
        factor *= 1.0 - 0.3 * self.decay_progress(page, day)
        return factor

    def position_drift(self, page: DemoPage, day: date) -> float:
        """Positions added to (worse) or removed from (better) the base position."""
        drift = 3.0 * self.decay_progress(page, day)
        if self.page_class(page).section == catalog.GROWING_SECTION:
            drift += 3.0 * min(self.age(day), HISTORY_DAYS) / HISTORY_DAYS
        return drift

    def position_on(self, query: DemoQuery, day: date) -> float:
        wobble = 0.6 * rng.gauss(self.seed, "pos", query.query, day)
        return min(
            max(query.base_position + self.position_drift(query.page, day) + wobble, 1.0), 100.0
        )

    def page_country_shares(self, page: DemoPage) -> dict[str, float]:
        """Market split for a page; store pages draw almost only from their own country."""
        if self.page_class(page).page_type == "store" and len(page.terms) == 1:
            home = "CA" if page.terms[0] in catalog.CANADIAN_STORES else "US"
            return {home: 0.94, ("US" if home == "CA" else "CA"): 0.06}
        return BASE_COUNTRY_SHARE

    def country_shares(self, query: DemoQuery) -> dict[str, float]:
        """Per-query market split: the page's split with some query-level variation."""
        base = self.page_country_shares(query.page)
        if base is not BASE_COUNTRY_SHARE:
            return base
        raw = {
            country: share * rng.between(self.seed, 0.7, 1.3, "country", query.query, country)
            for country, share in base.items()
        }
        total = sum(raw.values())
        return {country: share / total for country, share in raw.items()}

    def device_shares(self, page: DemoPage) -> dict[str, float]:
        return _DEVICE_SHARE[self.page_class(page).page_type]

    def expected_organic_clicks(self, page: DemoPage) -> float:
        """Steady-state organic clicks per day for a page, before stories."""
        return sum(
            query.demand
            * visibility(query.base_position)
            * min(expected_ctr(query.base_position) * query.ctr_factor, 0.65)
            for query in self.queries_for(page)
        )
