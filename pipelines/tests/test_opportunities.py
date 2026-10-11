from __future__ import annotations

import json

import httpx
import pytest

from map_pipelines.api_client import PlatformApi
from map_pipelines.opportunities.detect import (
    Thresholds,
    benchmark_ctr,
    find_ai_gaps,
    find_decaying_pages,
    find_striking_distance,
)
from map_pipelines.opportunities.runner import (
    detect,
    file_opportunities,
    plan_payload,
    task_payload,
)


def test_benchmark_ctr_declines_with_position() -> None:
    assert benchmark_ctr(1) == pytest.approx(0.30)
    assert 0.04 < benchmark_ctr(5) < 0.06
    assert 0.02 < benchmark_ctr(10) < 0.03
    assert benchmark_ctr(1) > benchmark_ctr(3) > benchmark_ctr(10) > benchmark_ctr(20)
    assert benchmark_ctr(0.5) == benchmark_ctr(1)


def query_row(**overrides) -> dict:
    row = {
        "query": "backpacking tents",
        "impressions": 20000,
        "clicks": 160,
        "position": 14.0,
        "page_id": 6,
        "url": "https://www.northpeak.example/categories/tents/",
    }
    row.update(overrides)
    return row


def test_striking_distance_detects_and_sizes_the_gain() -> None:
    (found,) = find_striking_distance([query_row()])
    assert found.kind == "striking_distance"
    assert found.key == "opportunity:striking:backpacking tents"
    assert found.page_id == 6
    expected_gain = 20000 * benchmark_ctr(5.0) - 160
    assert found.score == pytest.approx(expected_gain, abs=0.1)
    assert found.evidence["position"] == 14.0
    assert found.evidence["ctr"] == 0.008
    assert "position 14.0" in found.summary


@pytest.mark.parametrize(
    "overrides",
    [
        {"position": 7.9},  # already near the top
        {"position": 20.1},  # too far back
        {"impressions": 499},  # not enough demand
        {"clicks": 400},  # CTR already at benchmark for the position
        {"position": None},
    ],
)
def test_striking_distance_exclusions(overrides: dict) -> None:
    assert find_striking_distance([query_row(**overrides)]) == []


def test_striking_distance_boundaries_are_inclusive() -> None:
    rows = [
        query_row(query="a", position=8.0, clicks=10),
        query_row(query="b", position=20.0, clicks=10),
    ]
    assert len(find_striking_distance(rows)) == 2


def test_striking_distance_sorted_by_gain() -> None:
    rows = [
        query_row(query="small", impressions=1000, clicks=5),
        query_row(query="big", impressions=50000, clicks=300),
    ]
    assert [item.evidence["query"] for item in find_striking_distance(rows)] == ["big", "small"]


def test_thresholds_are_configurable() -> None:
    strict = Thresholds(min_impressions=50_000)
    assert find_striking_distance([query_row()], strict) == []


def page_row(**overrides) -> dict:
    row = {
        "url": "https://www.northpeak.example/blog/winter-camping-checklist/",
        "path": "/blog/winter-camping-checklist/",
        "title": "Winter Camping Checklist",
        "page_id": 22,
        "clicks": 1400,
        "clicks_prev": 2600,
        "position": 9.4,
        "position_prev": 6.8,
    }
    row.update(overrides)
    return row


def test_decaying_page_detected_with_evidence() -> None:
    (found,) = find_decaying_pages([page_row()])
    assert found.kind == "decaying_page"
    assert found.key.endswith("/blog/winter-camping-checklist/")
    assert found.score == 1200
    assert found.evidence["change"] == pytest.approx(-0.4615, abs=1e-4)
    assert "fell 46%" in found.summary
    assert "6.8 to 9.4" in found.summary


@pytest.mark.parametrize(
    "overrides",
    [
        {"clicks": 2000},  # -23%, under the threshold
        {"clicks": 3000},  # growing
        {"clicks_prev": 80, "clicks": 10},  # too small to matter
        {"clicks_prev": None},
    ],
)
def test_decaying_page_exclusions(overrides: dict) -> None:
    assert find_decaying_pages([page_row(**overrides)]) == []


def test_decay_threshold_is_inclusive() -> None:
    assert len(find_decaying_pages([page_row(clicks_prev=1000, clicks=750)])) == 1


def gap_row(**overrides) -> dict:
    row = {
        "prompt_id": 11,
        "prompt": "What is the best 20 degree down sleeping bag?",
        "topic": "Sleeping bags",
        "checks": 140,
        "brand_mentions": 14,
        "competitor_mentions": 131,
        "competitors": {"Summit & Co": 128, "TrailForge": 40},
    }
    row.update(overrides)
    return row


def test_ai_gap_detected() -> None:
    (found,) = find_ai_gaps([gap_row()])
    assert found.kind == "ai_gap"
    assert found.key == "opportunity:ai-gap:11"
    assert found.evidence["brand_mention_rate"] == 0.1
    assert "most often Summit & Co" in found.summary
    assert found.score == pytest.approx(131 / 140 - 0.1, abs=1e-4)


@pytest.mark.parametrize(
    "overrides",
    [
        {"brand_mentions": 60},  # brand is present often enough
        {"competitor_mentions": 30},  # nobody is mentioned much
        {"checks": 3, "brand_mentions": 0, "competitor_mentions": 3},  # too few answers
    ],
)
def test_ai_gap_exclusions(overrides: dict) -> None:
    assert find_ai_gaps([gap_row(**overrides)]) == []


def test_payloads() -> None:
    (striking,) = find_striking_distance([query_row()])
    task = task_payload(striking)
    assert task["source"] == "opportunity"
    assert task["dedupe_key"] == striking.key
    assert task["labels"] == ["seo", "striking-distance"]
    assert task["page_id"] == 6
    assert task["evidence"]["estimated_click_gain"] > 0

    (decay,) = find_decaying_pages([page_row()])
    assert task_payload(decay)["priority"] == "high"

    (gap,) = find_ai_gaps([gap_row()])
    plan = plan_payload(gap)
    assert plan["status"] == "idea"
    assert plan["source"] == "opportunity"
    assert plan["dedupe_key"] == "opportunity:ai-gap:11"
    assert plan["target_keyword"] == "what is the best 20 degree down sleeping bag"


def test_runner_detects_then_files_and_reports_duplicates() -> None:
    existing: dict[str, int] = {}
    requests: list[tuple[str, str, dict]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/api/v1/")
        if request.method == "GET":
            kind = request.url.params["type"]
            requests.append(("GET", kind, dict(request.url.params)))
            data = {
                "striking_distance": [query_row()],
                "decaying_pages": [page_row()],
                "ai_gaps": [gap_row()],
            }[kind]
            return httpx.Response(200, json={"data": data, "meta": {}})
        body = json.loads(request.content)
        requests.append(("POST", path, body))
        duplicate = body["dedupe_key"] in existing
        record_id = existing.setdefault(body["dedupe_key"], len(existing) + 1)
        return httpx.Response(
            200 if duplicate else 201,
            json={"data": {"id": record_id}, "meta": {"deduplicated": duplicate}},
        )

    api = PlatformApi(
        "http://app.test", "t", client=httpx.Client(transport=httpx.MockTransport(handler))
    )
    found = detect(api)
    assert [item.kind for item in found] == ["striking_distance", "decaying_page", "ai_gap"]
    striking_request = next(r for r in requests if r[1] == "striking_distance")
    assert striking_request[2]["position_min"] == "8.0"
    assert striking_request[2]["min_impressions"] == "500"

    first = file_opportunities(api, found)
    assert [(item.target, item.created) for item in first] == [
        ("task", True),
        ("task", True),
        ("plan", True),
    ]
    second = file_opportunities(api, found)
    assert [item.created for item in second] == [False, False, False]
    assert [item.record_id for item in second] == [item.record_id for item in first]


def test_per_kind_limit() -> None:
    posted: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        posted.append(json.loads(request.content))
        return httpx.Response(201, json={"data": {"id": len(posted)}, "meta": {}})

    api = PlatformApi(
        "http://app.test", "t", client=httpx.Client(transport=httpx.MockTransport(handler))
    )
    found = find_striking_distance([query_row(query=f"q{index}") for index in range(5)])
    filed = file_opportunities(api, found, per_kind=2)
    assert len(filed) == 2
    assert len(posted) == 2
