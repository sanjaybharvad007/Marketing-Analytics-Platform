"""Fulfil requested briefs: read plans and search data from the API, write briefs back."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from map_pipelines.api_client import ApiError, PlatformApi
from map_pipelines.briefs.builder import (
    BriefInputs,
    CandidatePage,
    RankingSnapshot,
    RelatedQuery,
    build_brief,
    tokens,
)
from map_pipelines.llm import LLMProvider
from map_pipelines.logs import get_logger

log = get_logger("briefs")

# Look-back for related queries; long enough to smooth weekly seasonality.
QUERY_RANGE = "90d"


@dataclass(frozen=True)
class BriefOutcome:
    plan_id: int
    title: str
    status: str
    source: str | None = None
    error: str | None = None


def _related_queries(api: PlatformApi, keyword: str) -> list[RelatedQuery]:
    """Queries containing any content word of the keyword, merged across words."""
    found: dict[str, RelatedQuery] = {}
    for token in dict.fromkeys(tokens(keyword)):
        rows = api.paginate(
            "seo/queries",
            q=token,
            range=QUERY_RANGE,
            compare="none",
            sort="impressions",
            dir="desc",
            page_size=50,
            limit=50,
        )
        for row in rows:
            found.setdefault(
                row["query"],
                RelatedQuery(
                    query=row["query"],
                    impressions=int(row["impressions"]),
                    clicks=int(row["clicks"]),
                    position=row.get("position"),
                ),
            )
    return list(found.values())


def _ranking(api: PlatformApi, keyword: str) -> RankingSnapshot:
    """Current tracked position for the exact keyword, if the SEO tool tracks it."""
    rows = api.paginate("seo/keywords", q=keyword, page_size=20, limit=20)
    for row in rows:
        if row["keyword"].lower() == keyword.lower():
            return RankingSnapshot(
                position=row.get("position"),
                url=row.get("url"),
                search_volume=row.get("search_volume"),
            )
    return RankingSnapshot()


def _candidate_pages(api: PlatformApi) -> list[CandidatePage]:
    rows = api.paginate(
        "seo/pages", range=QUERY_RANGE, compare="none", sort="clicks", dir="desc", limit=200
    )
    return [
        CandidatePage(
            url=row["url"],
            title=row.get("title") or row["path"],
            clicks=int(row["clicks"]),
            page_type=row.get("page_type") or "other",
        )
        for row in rows
    ]


def gather_inputs(
    api: PlatformApi, plan: dict[str, Any], pages: list[CandidatePage], brand_name: str
) -> BriefInputs:
    keyword = (plan.get("target_keyword") or plan["title"]).strip()
    return BriefInputs(
        title=plan["title"],
        target_keyword=keyword,
        intent=plan["intent"],
        page_type=plan["page_type"],
        target_url=plan.get("target_url"),
        related_queries=_related_queries(api, keyword),
        candidate_pages=pages,
        ranking=_ranking(api, keyword),
        brand_name=brand_name,
    )


def fulfil_requested_briefs(
    api: PlatformApi, provider: LLMProvider, *, brand_name: str, limit: int = 20
) -> list[BriefOutcome]:
    """Write a brief for every plan whose brief was requested.

    A failure on one plan marks that plan's brief as failed and moves on.
    """
    plans = list(api.paginate("plans", brief_status="requested", limit=limit))
    if not plans:
        return []
    pages = _candidate_pages(api)
    outcomes: list[BriefOutcome] = []
    for plan in plans:
        try:
            generated = build_brief(provider, gather_inputs(api, plan, pages, brand_name))
            api.put(
                f"plans/{plan['id']}/brief",
                {
                    "status": "ready",
                    "generated_by": generated.source,
                    "brief": generated.value.model_dump(mode="json"),
                },
            )
        except (ApiError, ValueError) as error:
            log.error("brief failed", extra={"plan_id": plan["id"], "error": str(error)})
            try:
                api.put(
                    f"plans/{plan['id']}/brief", {"status": "failed", "error": str(error)[:500]}
                )
            except ApiError as inner:
                log.error("could not mark brief failed", extra={"error": str(inner)})
            outcomes.append(BriefOutcome(plan["id"], plan["title"], "failed", error=str(error)))
            continue
        log.info("brief ready", extra={"plan_id": plan["id"], "source": generated.source})
        outcomes.append(BriefOutcome(plan["id"], plan["title"], "ready", source=generated.source))
    return outcomes
