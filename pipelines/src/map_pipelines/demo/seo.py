"""Synthetic SEO-tool data: tracked keyword rankings and domain authority metrics."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date
from typing import Any

from map_pipelines.demo import rng
from map_pipelines.demo.world import HISTORY_DAYS, DemoQuery, DemoWorld

TRACKED_KEYWORDS = 160
_SERP_FEATURES = (
    "people_also_ask",
    "ai_overview",
    "image_pack",
    "video",
    "shopping",
    "sitelinks",
    "local_pack",
    "featured_snippet",
)
_CPC_BY_INTENT = {
    "transactional": (0.9, 2.8),
    "commercial": (0.6, 2.1),
    "navigational": (0.2, 0.9),
    "informational": (0.05, 0.6),
}

# domain, is_own, authority score, referring domains, backlinks, daily growth
_DOMAINS = (
    ("northpeak.example", True, 53.0, 3050, 41200, 0.00065),
    ("summitandco.example", False, 63.0, 7400, 118000, 0.00040),
    ("trailforge.example", False, 49.0, 2600, 30500, 0.00020),
    ("alpenway.example", False, 41.0, 1450, 14800, -0.00010),
)


def tracked_keywords(world: DemoWorld) -> list[DemoQuery]:
    """The keywords an SEO team would track: the highest-demand queries."""
    ranked = sorted(world.queries, key=lambda query: query.demand, reverse=True)
    return ranked[:TRACKED_KEYWORDS]


def _serp_features(world: DemoWorld, query: DemoQuery, position: int) -> list[str]:
    features = [
        feature
        for feature in _SERP_FEATURES[:-1]
        if rng.uniform(world.seed, "serp", query.query, feature) < 0.28
    ]
    owns_snippet = position <= 5 and rng.uniform(world.seed, "snippet", query.query) < 0.35
    if query.intent == "informational" and owns_snippet:
        features.append("featured_snippet")
    return features


def keyword_rows(world: DemoWorld, day: date) -> Iterator[dict[str, Any]]:
    """Yield one ranking snapshot per tracked keyword for `day`."""
    for query in tracked_keywords(world):
        if world.age(day) > query.page.age_days:
            position = None  # page not published yet, so nothing ranks
        else:
            position = round(min(world.position_on(query, day), 100.0))
        low, high = _CPC_BY_INTENT[query.intent]
        monthly_volume = query.demand * 30 / 0.55
        yield {
            "date": day,
            "keyword": query.query,
            "position": position,
            "url": world.url(query.page) if position is not None else None,
            "search_volume": int(round(monthly_volume, -1)),
            "difficulty": int(rng.between(world.seed, 14, 86, "kd", query.query)),
            "cpc": round(rng.between(world.seed, low, high, "cpc", query.query), 2),
            "intent": query.intent,
            "serp_features": _serp_features(world, query, position or 100),
        }


def domain_rows(world: DemoWorld, day: date) -> Iterator[dict[str, Any]]:
    """Yield authority metrics for the brand and each competitor domain."""
    elapsed = HISTORY_DAYS - min(world.age(day), HISTORY_DAYS)
    for domain, is_own, authority, referring, backlinks, growth in _DOMAINS:
        factor = (1 + growth) ** elapsed
        yield {
            "date": day,
            "domain": domain,
            "is_own": is_own,
            "authority_score": round(authority + elapsed * growth * 40),
            "referring_domains": round(referring * factor),
            "backlinks": round(
                backlinks * factor * rng.between(world.seed, 0.995, 1.005, domain, day)
            ),
        }
