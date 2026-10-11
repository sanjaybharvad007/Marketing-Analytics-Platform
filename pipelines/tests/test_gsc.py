"""Search Console: row mapping, request body, startRow pagination and the transform."""

from __future__ import annotations

from datetime import date
from typing import Any

import pytest

from map_pipelines.etl.transforms import TransformContext, to_gsc_records
from map_pipelines.models import DateWindow
from map_pipelines.sources.base import SourceNotConfigured
from map_pipelines.sources.gsc import ROW_LIMIT, GscLiveSource, flatten_row

WINDOW = DateWindow(start=date(2026, 5, 29), end=date(2026, 5, 31))
PAGE = "https://www.northpeak.example/guides/how-to-fit-a-backpack/"


def _row(query: str = "how to fit a backpack", **overrides: Any) -> dict[str, Any]:
    row = {
        "keys": ["2026-05-30", PAGE, query, "usa", "MOBILE"],
        "clicks": 12,
        "impressions": 200,
        "ctr": 0.06,
        "position": 6.5,
    }
    row.update(overrides)
    return row


def test_flatten_row_names_the_keys() -> None:
    assert flatten_row(_row()) == {
        "date": "2026-05-30",
        "page": PAGE,
        "query": "how to fit a backpack",
        "country": "usa",
        "device": "MOBILE",
        "clicks": 12,
        "impressions": 200,
        "position": 6.5,
    }


def test_flatten_row_rejects_unexpected_key_count() -> None:
    with pytest.raises(ValueError, match="expected 5 keys"):
        flatten_row({"keys": ["2026-05-30", PAGE]})


class FakeService:
    """Mimics service.searchanalytics().query(siteUrl=..., body=...).execute()."""

    def __init__(self, pages: list[list[dict[str, Any]]]) -> None:
        self._pages = pages
        self.calls: list[dict[str, Any]] = []

    def searchanalytics(self) -> FakeService:
        return self

    def query(self, siteUrl: str, body: dict[str, Any]) -> FakeService:
        self.calls.append({"siteUrl": siteUrl, "body": body})
        return self

    def execute(self) -> dict[str, Any]:
        rows = self._pages[len(self.calls) - 1]
        return {"rows": rows} if rows else {}


def test_request_body() -> None:
    service = FakeService([[_row()]])
    list(GscLiveSource("sc-domain:northpeak.example", service=service).fetch(WINDOW))
    call = service.calls[0]
    assert call["siteUrl"] == "sc-domain:northpeak.example"
    assert call["body"] == {
        "startDate": "2026-05-29",
        "endDate": "2026-05-31",
        "dimensions": ["date", "page", "query", "country", "device"],
        "type": "web",
        "dataState": "final",
        "rowLimit": 25_000,
        "startRow": 0,
    }


def test_pagination_advances_start_row_until_a_short_page() -> None:
    full_page = [_row(f"query {index}") for index in range(ROW_LIMIT)]
    service = FakeService([full_page, full_page, [_row("last")]])
    rows = list(GscLiveSource("site", service=service).fetch(WINDOW))
    assert len(rows) == 2 * ROW_LIMIT + 1
    assert [call["body"]["startRow"] for call in service.calls] == [0, 25_000, 50_000]


def test_a_full_last_page_triggers_one_more_empty_request() -> None:
    full_page = [_row(f"query {index}") for index in range(ROW_LIMIT)]
    service = FakeService([full_page, []])
    assert len(list(GscLiveSource("site", service=service).fetch(WINDOW))) == ROW_LIMIT
    assert len(service.calls) == 2


def test_live_source_requires_a_site_url() -> None:
    with pytest.raises(SourceNotConfigured, match="GSC_SITE_URL"):
        GscLiveSource("")


def test_transform_stores_position_as_weighted_sum(ctx: TransformContext) -> None:
    records, rejected = to_gsc_records([flatten_row(_row())], ctx)
    assert rejected == 0
    (record,) = records
    assert record.date == date(2026, 5, 30)
    assert (record.country, record.device) == ("US", "mobile")
    assert record.sum_position == pytest.approx(6.5 * 200)
    assert record.is_brand is False


def test_weighted_position_aggregates_correctly_when_rows_merge(ctx: TransformContext) -> None:
    rows = [
        flatten_row(_row(position=4.0, impressions=100, clicks=10)),
        flatten_row(_row("How to  fit a Backpack", position=10.0, impressions=300, clicks=6)),
    ]
    records, _ = to_gsc_records(rows, ctx)
    (record,) = records
    assert record.query == "how to fit a backpack"
    assert (record.clicks, record.impressions) == (16, 400)
    assert record.sum_position / record.impressions == pytest.approx(8.5)


def test_brand_queries_are_flagged(ctx: TransformContext) -> None:
    records, _ = to_gsc_records([flatten_row(_row("north peak outfitters denver"))], ctx)
    assert records[0].is_brand is True


def test_bad_rows_are_rejected(ctx: TransformContext) -> None:
    rows = [
        flatten_row(_row()),
        flatten_row(_row("clicks above impressions", clicks=9, impressions=3)),
        {**flatten_row(_row("foreign")), "page": "https://www.summitandco.example/x/"},
        {**flatten_row(_row("bad device")), "device": "WATCH"},
    ]
    records, rejected = to_gsc_records(rows, ctx)
    assert len(records) == 1
    assert rejected == 3
