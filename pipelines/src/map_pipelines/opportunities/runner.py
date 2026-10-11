"""Fetch candidates from the API, detect opportunities, and file them as tasks or plan ideas."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from map_pipelines.api_client import PlatformApi
from map_pipelines.logs import get_logger
from map_pipelines.opportunities.detect import (
    Opportunity,
    Thresholds,
    find_ai_gaps,
    find_decaying_pages,
    find_striking_distance,
)

log = get_logger("opportunities")

_LABELS = {
    "striking_distance": ["seo", "striking-distance"],
    "decaying_page": ["seo", "content-refresh"],
}


@dataclass(frozen=True)
class Filed:
    opportunity: Opportunity
    target: str  # "task" or "plan"
    record_id: int
    created: bool


def detect(
    api: PlatformApi, thresholds: Thresholds | None = None, *, date_range: str = "28d"
) -> list[Opportunity]:
    """Run all three detectors against the reporting API."""
    t = thresholds or Thresholds()
    striking = api.get(
        "seo/opportunities",
        type="striking_distance",
        range=date_range,
        position_min=t.position_min,
        position_max=t.position_max,
        min_impressions=t.min_impressions,
    )
    decaying = api.get("seo/opportunities", type="decaying_pages", range=date_range)
    gaps = api.get("seo/opportunities", type="ai_gaps", range=date_range)
    return [
        *find_striking_distance(striking, t),
        *find_decaying_pages(decaying, t),
        *find_ai_gaps(gaps, t),
    ]


def task_payload(opportunity: Opportunity) -> dict[str, Any]:
    return {
        "title": opportunity.title,
        "description": opportunity.summary,
        "status": "backlog",
        "priority": "high" if opportunity.kind == "decaying_page" else "medium",
        "labels": _LABELS[opportunity.kind],
        "source": "opportunity",
        "dedupe_key": opportunity.key,
        "page_id": opportunity.page_id,
        "evidence": opportunity.evidence,
    }


def plan_payload(opportunity: Opportunity) -> dict[str, Any]:
    """AI gaps become plan ideas: closing them takes new or better content."""
    prompt = opportunity.evidence["prompt"]
    return {
        "title": f"Answer page: {prompt}"[:200],
        "target_keyword": prompt.rstrip("?").lower()[:200],
        "intent": "informational",
        "page_type": "guide",
        "status": "idea",
        "priority": "medium",
        "source": "opportunity",
        "dedupe_key": opportunity.key,
        "notes": (
            f"{opportunity.summary}\n\nGoal: publish a page that answers this prompt directly "
            "and is specific enough to be cited."
        ),
    }


def file_opportunities(
    api: PlatformApi, opportunities: list[Opportunity], *, per_kind: int = 8
) -> list[Filed]:
    """Create a task or plan idea for the top opportunities of each kind.

    The API deduplicates on the opportunity key, so re-running reports the
    existing record instead of creating another.
    """
    filed: list[Filed] = []
    counts: dict[str, int] = {}
    for opportunity in opportunities:
        counts[opportunity.kind] = counts.get(opportunity.kind, 0) + 1
        if counts[opportunity.kind] > per_kind:
            continue
        if opportunity.kind == "ai_gap":
            target, result = "plan", api.post("plans", plan_payload(opportunity))
        else:
            target, result = "task", api.post("tasks", task_payload(opportunity))
        created = not result.meta.get("deduplicated", False)
        filed.append(Filed(opportunity, target, int(result.data["id"]), created))
    log.info(
        "opportunities filed",
        extra={
            "found": len(opportunities),
            "filed": sum(1 for item in filed if item.created),
            "already_filed": sum(1 for item in filed if not item.created),
        },
    )
    return filed
