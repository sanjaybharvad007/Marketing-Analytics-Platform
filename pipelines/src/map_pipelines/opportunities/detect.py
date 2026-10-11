"""Pure detection logic over rows fetched from the reporting API."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

Kind = Literal["striking_distance", "decaying_page", "ai_gap"]


@dataclass(frozen=True)
class Thresholds:
    # Striking distance: bottom of page one through page two.
    position_min: float = 8.0
    position_max: float = 20.0
    min_impressions: int = 500
    # "Low CTR" means below this share of the benchmark CTR for the position.
    max_ctr_ratio: float = 0.75
    # The position a realistic optimisation could reach, used to size the gain.
    target_position: float = 5.0
    # Decay: clicks fell by at least this share versus the previous period.
    decay_min_previous_clicks: int = 100
    decay_drop: float = 0.25
    # AI gap: competitors named in most answers, the brand in few.
    gap_min_competitor_rate: float = 0.5
    gap_max_brand_rate: float = 0.2
    gap_min_checks: int = 5


@dataclass(frozen=True)
class Opportunity:
    kind: Kind
    # Stable identifier; becomes the task or plan dedupe key.
    key: str
    title: str
    summary: str
    # Comparable within a kind: estimated clicks gained or lost, or mention gap.
    score: float
    evidence: dict[str, Any] = field(default_factory=dict)
    page_id: int | None = None


def benchmark_ctr(position: float) -> float:
    """Typical organic click-through rate by average position.

    A smooth approximation of published CTR curves: about 30% at position 1,
    5% at position 5, 2.5% at position 10 and 1% at position 20.
    """
    return min(0.6, 0.30 * max(position, 1.0) ** -1.1)


def find_striking_distance(
    rows: Sequence[Mapping[str, Any]], thresholds: Thresholds | None = None
) -> list[Opportunity]:
    """Queries ranking 8-20 with real demand and a below-benchmark CTR.

    Each row needs `query`, `impressions`, `clicks`, `position` and may carry
    `page_id` and `url`. The score is the estimated extra clicks per period
    from reaching `target_position` at the benchmark CTR.
    """
    t = thresholds or Thresholds()
    found: list[Opportunity] = []
    for row in rows:
        impressions = int(row.get("impressions") or 0)
        position = row.get("position")
        if position is None or impressions < t.min_impressions:
            continue
        if not t.position_min <= float(position) <= t.position_max:
            continue
        clicks = int(row.get("clicks") or 0)
        ctr = clicks / impressions
        expected = benchmark_ctr(float(position))
        if ctr > expected * t.max_ctr_ratio:
            continue
        gain = impressions * benchmark_ctr(t.target_position) - clicks
        if gain <= 0:
            continue
        query = str(row["query"])
        found.append(
            Opportunity(
                kind="striking_distance",
                key=f"opportunity:striking:{query}",
                title=f'Move "{query}" onto page one',
                summary=(
                    f"Average position {float(position):.1f} with {impressions:,} impressions and "
                    f"a {ctr:.1%} CTR (benchmark {expected:.1%}). Reaching position "
                    f"{t.target_position:.0f} is worth about {gain:,.0f} more clicks per period."
                ),
                score=round(gain, 1),
                evidence={
                    "query": query,
                    "url": row.get("url"),
                    "position": round(float(position), 1),
                    "impressions": impressions,
                    "clicks": clicks,
                    "ctr": round(ctr, 4),
                    "benchmark_ctr": round(expected, 4),
                    "estimated_click_gain": round(gain),
                },
                page_id=row.get("page_id"),
            )
        )
    return sorted(found, key=lambda item: (-item.score, item.key))


def find_decaying_pages(
    rows: Sequence[Mapping[str, Any]], thresholds: Thresholds | None = None
) -> list[Opportunity]:
    """Pages whose clicks dropped period over period beyond the threshold.

    Each row needs `url`, `clicks` and `clicks_prev`. The score is clicks lost.
    """
    t = thresholds or Thresholds()
    found: list[Opportunity] = []
    for row in rows:
        previous = int(row.get("clicks_prev") or 0)
        current = int(row.get("clicks") or 0)
        if previous < t.decay_min_previous_clicks:
            continue
        drop = (previous - current) / previous
        if drop < t.decay_drop:
            continue
        url = str(row["url"])
        label = row.get("title") or row.get("path") or url
        position, position_prev = row.get("position"), row.get("position_prev")
        moved = (
            f" Average position went from {float(position_prev):.1f} to {float(position):.1f}."
            if position is not None and position_prev is not None
            else ""
        )
        found.append(
            Opportunity(
                kind="decaying_page",
                key=f"opportunity:decay:{url}",
                title=f"Refresh decaying page: {label}"[:200],
                summary=(
                    f"Clicks fell {drop:.0%} versus the previous period "
                    f"({previous:,} to {current:,}).{moved}"
                ),
                score=float(previous - current),
                evidence={
                    "url": url,
                    "clicks": current,
                    "clicks_prev": previous,
                    "change": round(-drop, 4),
                    "position": position,
                    "position_prev": position_prev,
                },
                page_id=row.get("page_id"),
            )
        )
    return sorted(found, key=lambda item: (-item.score, item.key))


def find_ai_gaps(
    rows: Sequence[Mapping[str, Any]], thresholds: Thresholds | None = None
) -> list[Opportunity]:
    """Prompts where answer engines name competitors but rarely the brand.

    Each row needs `prompt_id`, `prompt`, `checks`, `brand_mentions` and
    `competitor_mentions` (answers naming at least one competitor), and may
    carry `topic` and `competitors` (name -> answers naming it).
    """
    t = thresholds or Thresholds()
    found: list[Opportunity] = []
    for row in rows:
        checks = int(row.get("checks") or 0)
        if checks < t.gap_min_checks:
            continue
        brand_rate = int(row.get("brand_mentions") or 0) / checks
        competitor_rate = int(row.get("competitor_mentions") or 0) / checks
        if brand_rate > t.gap_max_brand_rate or competitor_rate < t.gap_min_competitor_rate:
            continue
        competitors: Mapping[str, int] = row.get("competitors") or {}
        leader = max(competitors, key=lambda name: competitors[name]) if competitors else None
        prompt = str(row["prompt"])
        found.append(
            Opportunity(
                kind="ai_gap",
                key=f"opportunity:ai-gap:{row['prompt_id']}",
                title=f"Earn AI mentions for: {prompt}"[:200],
                summary=(
                    f"Competitors are named in {competitor_rate:.0%} of {checks} answers"
                    + (f" (most often {leader})" if leader else "")
                    + f"; the brand in {brand_rate:.0%}."
                ),
                score=round(competitor_rate - brand_rate, 4),
                evidence={
                    "prompt_id": row["prompt_id"],
                    "prompt": prompt,
                    "topic": row.get("topic"),
                    "checks": checks,
                    "brand_mention_rate": round(brand_rate, 4),
                    "competitor_mention_rate": round(competitor_rate, 4),
                    "competitors": dict(competitors),
                },
            )
        )
    return sorted(found, key=lambda item: (-item.score, item.key))
