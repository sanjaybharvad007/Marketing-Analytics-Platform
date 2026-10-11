"""GA4: response mapping, request construction, pagination and the transform."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import pytest

from map_pipelines.etl.transforms import TransformContext, to_ga_records
from map_pipelines.models import DateWindow
from map_pipelines.sources.base import Source, SourceNotConfigured
from map_pipelines.sources.ga4 import DIMENSIONS, METRICS, PAGE_SIZE, Ga4LiveSource, report_rows

WINDOW = DateWindow(start=date(2026, 5, 29), end=date(2026, 5, 31))


def _response(rows: list[list[str]], row_count: int | None = None) -> SimpleNamespace:
    """A stand-in with the attributes of google.analytics.data_v1beta RunReportResponse."""
    return SimpleNamespace(
        dimension_headers=[SimpleNamespace(name=name) for name in DIMENSIONS],
        metric_headers=[SimpleNamespace(name=name) for name in METRICS],
        rows=[
            SimpleNamespace(
                dimension_values=[SimpleNamespace(value=v) for v in row[: len(DIMENSIONS)]],
                metric_values=[SimpleNamespace(value=v) for v in row[len(DIMENSIONS) :]],
            )
            for row in rows
        ],
        row_count=len(rows) if row_count is None else row_count,
    )


ROW = ["20260530", "/blog/post", "Organic Search", "mobile", "US", "120", "101", "77", "3", "0"]


def test_report_rows_keys_values_by_header_name() -> None:
    (row,) = report_rows(_response([ROW]))
    assert row == {
        "date": "20260530",
        "pagePath": "/blog/post",
        "sessionDefaultChannelGroup": "Organic Search",
        "deviceCategory": "mobile",
        "countryId": "US",
        "sessions": "120",
        "totalUsers": "101",
        "engagedSessions": "77",
        "keyEvents": "3",
        "totalRevenue": "0",
    }


class FakeClient:
    def __init__(self, pages: list[SimpleNamespace]) -> None:
        self._pages = pages
        self.requests: list[dict[str, Any]] = []

    def run_report(self, request: dict[str, Any]) -> SimpleNamespace:
        self.requests.append(request)
        return self._pages[len(self.requests) - 1]


def test_live_source_builds_the_documented_request() -> None:
    client = FakeClient([_response([ROW])])
    source = Ga4LiveSource("123456", client=client)
    assert isinstance(source, Source)
    assert len(list(source.fetch(WINDOW))) == 1
    request = client.requests[0]
    assert request["property"] == "properties/123456"
    assert request["date_ranges"] == [{"start_date": "2026-05-29", "end_date": "2026-05-31"}]
    assert [d["name"] for d in request["dimensions"]] == [
        "date",
        "pagePath",
        "sessionDefaultChannelGroup",
        "deviceCategory",
        "countryId",
    ]
    assert [m["name"] for m in request["metrics"]] == list(METRICS)
    assert request["limit"] == PAGE_SIZE
    assert request["offset"] == 0


def test_live_source_pages_until_row_count_is_reached() -> None:
    client = FakeClient(
        [
            _response([ROW, ROW], row_count=5),
            _response([ROW, ROW], row_count=5),
            _response([ROW], row_count=5),
        ]
    )
    rows = list(Ga4LiveSource("1", client=client).fetch(WINDOW))
    assert len(rows) == 5
    assert [request["offset"] for request in client.requests] == [0, 2, 4]


def test_live_source_stops_on_an_empty_page() -> None:
    client = FakeClient([_response([], row_count=0)])
    assert list(Ga4LiveSource("1", client=client).fetch(WINDOW)) == []
    assert len(client.requests) == 1


def test_live_source_requires_a_property_id() -> None:
    with pytest.raises(SourceNotConfigured, match="GA4_PROPERTY_ID"):
        Ga4LiveSource("")


def test_transform_normalises_and_validates(ctx: TransformContext) -> None:
    records, rejected = to_ga_records(report_rows(_response([ROW])), ctx)
    assert rejected == 0
    (record,) = records
    assert record.date == date(2026, 5, 30)
    assert record.url == "https://www.northpeak.example/blog/post/"
    assert (record.channel, record.device, record.country) == ("Organic Search", "mobile", "US")
    assert (record.sessions, record.users, record.engaged_sessions, record.conversions) == (
        120,
        101,
        77,
        3,
    )
    assert record.revenue == Decimal("0.00")


def test_transform_merges_rows_that_normalise_to_one_key(ctx: TransformContext) -> None:
    rows = [
        {**dict(zip((*DIMENSIONS, *METRICS), ROW, strict=True))},
        {
            **dict(zip((*DIMENSIONS, *METRICS), ROW, strict=True)),
            "pagePath": "/Blog/Post/?utm_source=newsletter",
            "sessions": "30",
            "totalUsers": "25",
            "engagedSessions": "10",
            "keyEvents": "1",
            "totalRevenue": "148.50",
        },
    ]
    records, rejected = to_ga_records(rows, ctx)
    assert rejected == 0
    (record,) = records
    assert record.sessions == 150
    assert record.users == 126
    assert record.conversions == 4
    assert record.revenue == Decimal("148.50")


def test_transform_rejects_bad_rows_and_keeps_good_ones(ctx: TransformContext) -> None:
    good = dict(zip((*DIMENSIONS, *METRICS), ROW, strict=True))
    rows = [
        good,
        {**good, "deviceCategory": "fridge"},
        {**good, "date": "not-a-date"},
        {**good, "sessions": "-4", "pagePath": "/negative/"},
        {key: value for key, value in good.items() if key != "sessions"},
    ]
    records, rejected = to_ga_records(rows, ctx)
    assert len(records) == 1
    assert rejected == 4


def test_blank_channel_and_unknown_country_get_placeholders(ctx: TransformContext) -> None:
    row = dict(zip((*DIMENSIONS, *METRICS), ROW, strict=True))
    records, _ = to_ga_records(
        [{**row, "sessionDefaultChannelGroup": "", "countryId": "(not set)"}], ctx
    )
    assert records[0].channel == "Unassigned"
    assert records[0].country == "ZZ"
