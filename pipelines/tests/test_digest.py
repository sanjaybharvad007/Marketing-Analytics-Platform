from __future__ import annotations

import httpx

from map_pipelines.api_client import PlatformApi
from map_pipelines.digest.build import (
    DigestData,
    build_digest,
    build_prompt,
    change,
    format_change,
    format_value,
    heuristic_narrative,
    render,
)
from map_pipelines.llm import Generated, OfflineProvider

KPIS = {
    "sessions": {"value": 110000.0, "previous": 100000.0},
    "users": {"value": 95000.0, "previous": 90000.0},
    "conversions": {"value": 1900.0, "previous": 2000.0},
    "clicks": {"value": 21000.0, "previous": 20000.0},
    "impressions": {"value": 470000.0, "previous": 450000.0},
    "ctr": {"value": 0.0447, "previous": 0.0444},
    "position": {"value": 9.1, "previous": 9.6},
    "ai_visibility_score": {"value": 31.2, "previous": 29.0},
}
DATA = DigestData(
    period={"from": "2026-05-25", "to": "2026-05-31"},
    previous_period={"from": "2026-05-18", "to": "2026-05-24"},
    kpis=KPIS,
    winners=[
        {
            "path": "/guides/backpacking-for-beginners/",
            "clicks": 900,
            "clicks_prev": 700,
            "clicks_delta": 200,
        }
    ],
    losers=[
        {
            "path": "/blog/winter-camping-checklist/",
            "clicks": 300,
            "clicks_prev": 520,
            "clicks_delta": -220,
        }
    ],
    audit={
        "run": {"health_score": "89.0", "pages_crawled": 25},
        "counts": {
            "by_severity": {"critical": 1, "high": 4, "medium": 10, "low": 10},
            "by_rule": [{"rule": "thin_content", "severity": "medium", "count": 2}],
        },
    },
    ai={
        "score": 31.2,
        "score_prev": 29.0,
        "mention_rate": 0.41,
        "citation_rate": 0.16,
        "by_engine": [
            {"engine": "chatgpt", "score": 35.0, "mention_rate": 0.44, "citation_rate": 0.12}
        ],
    },
)


def test_change_and_formatting() -> None:
    assert change(110, 100) == 0.1
    assert change(5, 0) is None
    assert change(None, 3) is None
    assert format_value(1234567.4, "number") == "1,234,567"
    assert format_value(0.0447, "percent") == "4.47%"
    assert format_value(9.14, "position") == "9.1"
    assert format_value(None, "number") == "n/a"
    assert format_change(110, 100, "number") == "+10.0%"
    assert format_change(9.1, 9.6, "position") == "-0.5"
    assert format_change(31.2, 29.0, "score") == "+2.2"
    assert format_change(1, None, "number") == "n/a"


def test_heuristic_narrative_leads_with_the_biggest_moves() -> None:
    text = heuristic_narrative(DATA)
    assert text.startswith("Week over week, sessions rose 10.0%")
    assert "users rose 5.6%" in text
    assert "Average position improved by 0.5 to 9.1." in text
    assert "/guides/backpacking-for-beginners/ (+200 clicks)" in text
    assert "/blog/winter-camping-checklist/ (-220 clicks)" in text
    assert "scored 89/100 with 5 critical or high-severity issue(s)" in text
    assert "AI visibility is at 31.2, up 2.2 points." in text


def test_heuristic_narrative_keeps_acronyms_upper_case() -> None:
    kpis = {"ctr": {"value": 0.05, "previous": 0.04}, "clicks": {"value": 90.0, "previous": 100.0}}
    data = DigestData(period={"from": "a", "to": "b"}, previous_period=None, kpis=kpis)
    assert (
        heuristic_narrative(data) == "Week over week, CTR rose 25.0% and organic clicks fell 10.0%."
    )


def test_heuristic_narrative_with_no_data() -> None:
    empty = DigestData(period={"from": "a", "to": "b"}, previous_period=None, kpis={})
    assert heuristic_narrative(empty) == "No data was available for this period."


def test_render_markdown_sections_and_tables() -> None:
    markdown = render(DATA, Generated("A steady week.", "heuristic"))
    assert markdown.startswith(
        "# Weekly marketing digest: 2026-05-25 to 2026-05-31\n\nA steady week."
    )
    assert "_Summary written by rules._" in markdown
    assert "| Sessions | 110,000 | 100,000 | +10.0% |" in markdown
    assert "| Average position | 9.1 | 9.6 | -0.5 |" in markdown
    assert "## Pages gaining clicks" in markdown
    assert "## Pages losing clicks" in markdown
    assert "| /blog/winter-camping-checklist/ | 300 | 520 | -220 |" in markdown
    assert "Health score **89.0** across 25 pages" in markdown
    assert "Visibility score **31.2** (+2.2 points)" in markdown
    assert "| ChatGPT | 35.0 | 44% | 12% |" in markdown
    assert markdown.endswith("\n")
    assert not markdown.endswith("\n\n")


def test_render_marks_llm_authorship() -> None:
    assert "_Summary written by language model._" in render(DATA, Generated("x", "llm"))


def test_prompt_contains_only_supplied_figures() -> None:
    prompt = build_prompt(DATA)
    assert "Sessions: 110,000 (previous 100,000, change +10.0%)" in prompt
    assert "- /blog/winter-camping-checklist/: -220" in prompt


def test_build_digest_end_to_end_against_a_mock_api() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/api/v1/")
        params = request.url.params
        if path == "metrics/overview":
            assert params["range"] == "7d"
            assert params["compare"] == "previous"
            return httpx.Response(
                200,
                json={
                    "data": {"range": DATA.period, "compare": DATA.previous_period, "kpis": KPIS}
                },
            )
        if path == "seo/pages":
            assert params["sort"] == "clicks_delta"
            rows = (
                (DATA.winners + DATA.losers)
                if params["dir"] == "desc"
                else (DATA.losers + DATA.winners)
            )
            return httpx.Response(200, json={"data": rows, "meta": {}})
        if path == "audits/latest":
            return httpx.Response(200, json={"data": DATA.audit})
        if path == "ai-visibility/summary":
            return httpx.Response(200, json={"data": DATA.ai})
        raise AssertionError(path)

    api = PlatformApi(
        "http://app.test", client=httpx.Client(transport=httpx.MockTransport(handler))
    )
    data, markdown = build_digest(api, OfflineProvider())
    assert [row["path"] for row in data.winners] == ["/guides/backpacking-for-beginners/"]
    assert [row["path"] for row in data.losers] == ["/blog/winter-camping-checklist/"]
    assert "Week over week" in markdown
