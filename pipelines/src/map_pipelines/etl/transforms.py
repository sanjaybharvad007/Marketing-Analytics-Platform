"""Turn raw source rows into validated, normalised records.

Each function returns the records plus the number of rejected rows. Rows that
collapse onto the same key after normalisation (for example two casings of
one path) are merged so a batch never contains duplicate keys.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from pydantic import ValidationError

from map_pipelines.logs import get_logger
from map_pipelines.models import (
    AiResultRecord,
    DomainMetricRecord,
    GaRecord,
    GscRecord,
    KeywordRankingRecord,
    PageRecord,
)
from map_pipelines.sources.mentions import TrackedBrand, analyse_answer
from map_pipelines.transform.classify import (
    DEFAULT_PATH_RULES,
    BrandClassifier,
    PathRule,
    classify_intent,
    classify_path,
)
from map_pipelines.transform.geo import normalize_country, normalize_device
from map_pipelines.transform.urls import ForeignUrlError, normalize_url, url_path

log = get_logger("etl.transform")
_MAX_LOGGED_REJECTS = 5


@dataclass(frozen=True)
class TransformContext:
    site_url: str
    brand: BrandClassifier
    path_rules: Sequence[PathRule] = DEFAULT_PATH_RULES


@dataclass
class Rejects:
    """Counts rejected rows and logs the first few reasons."""

    source: str
    count: int = 0
    _logged: int = field(default=0, repr=False)

    def add(self, reason: object, row: Mapping[str, Any]) -> None:
        self.count += 1
        if self._logged < _MAX_LOGGED_REJECTS:
            self._logged += 1
            log.warning(
                "row rejected",
                extra={"source": self.source, "reason": str(reason)[:200], "row": dict(row)},
            )


def parse_date(value: Any) -> date:
    """Accept a date, an ISO string, or GA4's compact YYYYMMDD."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if len(text) == 8 and text.isdigit():
        return datetime.strptime(text, "%Y%m%d").date()
    return date.fromisoformat(text[:10])


def _to_int(value: Any) -> int:
    return int(float(value))


def page_record(url: str, ctx: TransformContext) -> PageRecord:
    path = url_path(url)
    page_class = classify_path(path, ctx.path_rules)
    return PageRecord(
        url=url, path=path, section=page_class.section, page_type=page_class.page_type
    )


def to_ga_records(
    rows: Iterable[Mapping[str, Any]], ctx: TransformContext
) -> tuple[list[GaRecord], int]:
    rejects = Rejects("ga4")
    merged: dict[tuple, list] = {}
    for row in rows:
        try:
            key = (
                parse_date(row["date"]),
                normalize_url(row["pagePath"], ctx.site_url),
                (row.get("sessionDefaultChannelGroup") or "").strip() or "Unassigned",
                normalize_device(row["deviceCategory"]),
                normalize_country(row.get("countryId")),
            )
            values = [
                _to_int(row["sessions"]),
                _to_int(row["totalUsers"]),
                _to_int(row["engagedSessions"]),
                _to_int(row["keyEvents"]),
                Decimal(str(row.get("totalRevenue") or "0")),
            ]
        except (KeyError, ValueError, TypeError, InvalidOperation, ForeignUrlError) as error:
            rejects.add(error, row)
            continue
        if key in merged:
            merged[key] = [left + right for left, right in zip(merged[key], values, strict=True)]
        else:
            merged[key] = values

    records: list[GaRecord] = []
    for (day, url, channel, device, country), values in merged.items():
        sessions, users, engaged, conversions, revenue = values
        try:
            records.append(
                GaRecord(
                    date=day,
                    url=url,
                    channel=channel,
                    device=device,
                    country=country,
                    sessions=sessions,
                    users=users,
                    engaged_sessions=engaged,
                    conversions=conversions,
                    revenue=revenue.quantize(Decimal("0.01")),
                )
            )
        except ValidationError as error:
            rejects.add(error, {"date": day, "url": url, "channel": channel})
    return records, rejects.count


def to_gsc_records(
    rows: Iterable[Mapping[str, Any]], ctx: TransformContext
) -> tuple[list[GscRecord], int]:
    rejects = Rejects("gsc")
    merged: dict[tuple, list[float]] = {}
    for row in rows:
        try:
            query = " ".join(str(row["query"]).split()).lower()
            key = (
                parse_date(row["date"]),
                normalize_url(row["page"], ctx.site_url),
                query,
                normalize_country(row.get("country")),
                normalize_device(row["device"]),
            )
            impressions = _to_int(row["impressions"])
            values = [
                float(_to_int(row["clicks"])),
                float(impressions),
                float(row["position"]) * impressions,
            ]
        except (KeyError, ValueError, TypeError, ForeignUrlError) as error:
            rejects.add(error, row)
            continue
        if key in merged:
            merged[key] = [left + right for left, right in zip(merged[key], values, strict=True)]
        else:
            merged[key] = values

    records: list[GscRecord] = []
    for (day, url, query, country, device), (clicks, impressions, sum_position) in merged.items():
        try:
            records.append(
                GscRecord(
                    date=day,
                    url=url,
                    query=query,
                    country=country,
                    device=device,
                    clicks=int(clicks),
                    impressions=int(impressions),
                    sum_position=sum_position,
                    is_brand=ctx.brand.is_brand(query),
                )
            )
        except ValidationError as error:
            rejects.add(error, {"date": day, "url": url, "query": query})
    return records, rejects.count


def to_keyword_records(
    rows: Iterable[Mapping[str, Any]], ctx: TransformContext
) -> tuple[list[KeywordRankingRecord], int]:
    rejects = Rejects("seo")
    by_key: dict[tuple[date, str], KeywordRankingRecord] = {}
    for row in rows:
        try:
            keyword = " ".join(str(row["keyword"]).split()).lower()
            url = row.get("url")
            if url:
                try:
                    url = normalize_url(url, ctx.site_url)
                except ForeignUrlError:
                    url = None  # the keyword ranks with a URL outside the tracked site
            cpc = row.get("cpc")
            record = KeywordRankingRecord(
                date=parse_date(row["date"]),
                keyword=keyword,
                url=url or None,
                position=row.get("position") if url else None,
                search_volume=row.get("search_volume") or 0,
                difficulty=row.get("difficulty"),
                intent=row.get("intent")
                or classify_intent(keyword, is_brand=ctx.brand.is_brand(keyword)),
                cpc=None if cpc is None else Decimal(str(cpc)).quantize(Decimal("0.01")),
                serp_features=tuple(row.get("serp_features") or ()),
            )
        except (KeyError, ValueError, TypeError, InvalidOperation, ValidationError) as error:
            rejects.add(error, row)
            continue
        key = (record.date, record.keyword)
        existing = by_key.get(key)
        # An export can list a keyword once per ranking URL; keep the best position.
        if existing is None or (record.position or 101) < (existing.position or 101):
            by_key[key] = record
    return list(by_key.values()), rejects.count


def to_domain_records(rows: Iterable[Mapping[str, Any]]) -> tuple[list[DomainMetricRecord], int]:
    rejects = Rejects("seo.domains")
    by_key: dict[tuple[date, str], DomainMetricRecord] = {}
    for row in rows:
        try:
            record = DomainMetricRecord.model_validate(dict(row))
        except ValidationError as error:
            rejects.add(error, row)
            continue
        by_key[(record.date, record.domain)] = record
    return list(by_key.values()), rejects.count


def to_ai_records(
    rows: Iterable[Mapping[str, Any]],
    brand: TrackedBrand,
    competitors: Sequence[TrackedBrand],
) -> tuple[list[AiResultRecord], int]:
    """Run the mention parser over each raw answer."""
    rejects = Rejects("ai_visibility")
    by_key: dict[tuple, AiResultRecord] = {}
    for row in rows:
        try:
            analysis = analyse_answer(str(row["answer"]), brand, competitors)
            record = AiResultRecord(
                date=parse_date(row["date"]),
                prompt_id=row["prompt_id"],
                engine=row["engine"],
                brand_mentioned=analysis.brand_mentioned,
                brand_rank=analysis.brand_rank,
                cited=analysis.cited,
                cited_url=analysis.cited_url,
                sentiment=analysis.sentiment,
                competitors_mentioned=analysis.competitors_mentioned,
                answer_excerpt=analysis.answer_excerpt,
            )
        except (KeyError, ValueError, TypeError, ValidationError) as error:
            rejects.add(error, {key: value for key, value in row.items() if key != "answer"})
            continue
        by_key[(record.date, record.prompt_id, record.engine)] = record
    return list(by_key.values()), rejects.count
