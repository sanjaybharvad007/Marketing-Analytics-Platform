from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from map_pipelines.etl.transforms import TransformContext, to_domain_records, to_keyword_records
from map_pipelines.models import DateWindow
from map_pipelines.sources.base import SourceNotConfigured
from map_pipelines.sources.seo_csv import (
    PRESETS,
    ColumnMapping,
    SeoCsvSource,
    date_from_filename,
    decode_export,
    read_domain_metrics_csv,
    read_keyword_csv,
    resolve_mapping,
)

FIXTURES = Path(__file__).parent / "fixtures"
DEFAULT_DAY = date(2026, 1, 1)


def _semrush() -> list[dict]:
    text = decode_export((FIXTURES / "semrush_positions_2026-05-30.csv").read_bytes())
    return list(read_keyword_csv(text, PRESETS["semrush"], DEFAULT_DAY))


def test_semrush_rows_are_parsed() -> None:
    rows = {row["keyword"]: row for row in _semrush()}
    tents = rows["backpacking tents"]
    assert tents["position"] == 14
    assert tents["search_volume"] == 22200
    assert tents["difficulty"] == 62
    assert tents["cpc"] == 1.38
    assert tents["intent"] == "commercial"
    assert tents["serp_features"] == ["people_also_ask", "ai_overview", "image_pack"]
    assert tents["date"] == date(2026, 5, 30)


def test_keywords_are_lowercased_and_blank_keywords_skipped() -> None:
    keywords = [row["keyword"] for row in _semrush()]
    assert "how to waterproof a tent" in keywords
    assert "" not in keywords
    assert len(keywords) == 6


def test_quoted_fields_and_thousands_separators() -> None:
    row = next(row for row in _semrush() if row["keyword"] == "hiking boots, waterproof")
    assert row["search_volume"] == 12100
    assert row["intent"] is None


def test_first_listed_intent_wins() -> None:
    row = next(row for row in _semrush() if row["keyword"] == "how to waterproof a tent")
    assert row["intent"] == "informational"


def test_missing_position_means_not_ranking() -> None:
    row = next(row for row in _semrush() if row["keyword"] == "trekking poles")
    assert row["position"] is None
    assert row["url"] is None


def test_ahrefs_utf16_tab_delimited_export() -> None:
    text = decode_export((FIXTURES / "ahrefs_organic_keywords.csv").read_bytes())
    rows = list(read_keyword_csv(text, PRESETS["ahrefs"], DEFAULT_DAY))
    assert [row["keyword"] for row in rows] == [
        "sleeping bag temperature ratings",
        "down sleeping bags",
        "rain jackets",
    ]
    assert rows[0]["position"] == 5
    assert rows[0]["date"] == date(2026, 5, 29)
    assert rows[0]["serp_features"] == ["featured_snippet", "people_also_ask"]
    assert rows[1]["serp_features"] == ["shopping_results"]
    # "100+" is outside the tracked depth.
    assert rows[2]["position"] is None


def test_custom_mapping_from_json_with_semicolon_delimiter() -> None:
    mapping = resolve_mapping(str(FIXTURES / "custom_mapping.json"))
    rows = list(
        read_keyword_csv((FIXTURES / "custom_export.csv").read_text(), mapping, DEFAULT_DAY)
    )
    assert rows[0] == {
        "date": DEFAULT_DAY,
        "keyword": "camp stoves",
        "position": 7,
        "url": "/categories/camp-stoves/",
        "search_volume": 4400,
        "difficulty": None,
        "cpc": None,
        "intent": None,
        "serp_features": ["video", "shopping"],
    }
    assert rows[1]["serp_features"] == []


def test_missing_required_column_is_reported() -> None:
    with pytest.raises(ValueError, match="'Position' not found"):
        list(read_keyword_csv("Keyword,URL\ntents,/x/\n", PRESETS["semrush"], DEFAULT_DAY))


def test_unknown_mapping_key_is_rejected() -> None:
    with pytest.raises(ValueError, match="unknown mapping keys"):
        ColumnMapping.from_json('{"keyword": "k", "position": "p", "url": "u", "volumee": "v"}')


def test_resolve_mapping_rejects_unknown_name() -> None:
    with pytest.raises(ValueError, match="neither a preset"):
        resolve_mapping("moz")


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("organic-keywords-2026-05-30.csv", date(2026, 5, 30)),
        ("export_20260530.csv", date(2026, 5, 30)),
        ("keywords.csv", None),
        ("export-2026-13-45.csv", None),
    ],
)
def test_date_from_filename(name: str, expected: date | None) -> None:
    assert date_from_filename(name) == expected


def test_transform_normalises_urls_and_fills_intent(ctx: TransformContext) -> None:
    records, rejected = to_keyword_records(_semrush(), ctx)
    by_keyword = {record.keyword: record for record in records}
    assert rejected == 0
    boots = by_keyword["hiking boots, waterproof"]
    assert boots.url == "https://www.northpeak.example/categories/hiking-boots/"
    assert boots.intent == "commercial"
    assert by_keyword["northpeak outfitters"].cpc == Decimal("0.35")
    # A keyword ranking with a competitor URL is kept, without a page or position.
    foreign = by_keyword["competitor only term"]
    assert foreign.url is None
    assert foreign.position is None


def test_duplicate_keyword_keeps_best_position(ctx: TransformContext) -> None:
    rows = [
        {"date": DEFAULT_DAY, "keyword": "tents", "position": 9, "url": "/a/"},
        {"date": DEFAULT_DAY, "keyword": "tents", "position": 4, "url": "/b/"},
        {"date": DEFAULT_DAY, "keyword": "tents", "position": None, "url": None},
    ]
    records, _ = to_keyword_records(rows, ctx)
    assert len(records) == 1
    assert records[0].position == 4
    assert records[0].url.endswith("/b/")


def test_directory_source_filters_by_filename_date(tmp_path: Path) -> None:
    for name in ("semrush_positions_2026-05-30.csv", "domain-metrics.csv"):
        (tmp_path / name).write_bytes((FIXTURES / name).read_bytes())
    (tmp_path / "undated.csv").write_text("Keyword,Position,URL\nx,1,/\n")
    source = SeoCsvSource(tmp_path, PRESETS["semrush"], "northpeak.example")

    inside = DateWindow(start=date(2026, 5, 28), end=date(2026, 5, 31))
    assert len(list(source.fetch(inside))) == 6
    outside = DateWindow(start=date(2026, 6, 1), end=date(2026, 6, 3))
    assert list(source.fetch(outside)) == []

    domains = list(source.fetch_domain_metrics(inside))
    assert {row["domain"] for row in domains} == {"northpeak.example", "summitandco.example"}
    assert next(row for row in domains if row["domain"] == "northpeak.example")["is_own"] is True


def test_directory_source_requires_existing_directory(tmp_path: Path) -> None:
    with pytest.raises(SourceNotConfigured):
        SeoCsvSource(tmp_path / "missing", PRESETS["semrush"], "northpeak.example")


def test_domain_metrics_rows_validate() -> None:
    rows = list(
        read_domain_metrics_csv((FIXTURES / "domain-metrics.csv").read_text(), "northpeak.example")
    )
    assert len(rows) == 3  # the row with an unparseable date is skipped
    records, rejected = to_domain_records(rows)
    assert rejected == 0
    assert {record.domain for record in records} == {
        "northpeak.example",
        "summitandco.example",
        "alpenway.example",
    }
