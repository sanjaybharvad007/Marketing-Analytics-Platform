from __future__ import annotations

import json
from datetime import UTC, datetime

import httpx
import pytest

from map_pipelines.api_client import PlatformApi
from map_pipelines.audit.runner import AuditReport, audit_payload, publish, task_payload
from map_pipelines.audit.score import health_score
from map_pipelines.audit.site import CrawlResult, Fetch, Issue, Page
from map_pipelines.audit.summary import AuditSummary, build_prompt, heuristic_summary, summarise
from map_pipelines.llm import LLMError, OfflineProvider

SITE = "https://www.northpeak.example"


def issue(rule: str, severity: str, path: str = "/a/") -> Issue:
    return Issue(rule=rule, severity=severity, url=f"{SITE}{path}", message=f"{rule} found")  # type: ignore[arg-type]


def test_score_is_100_without_issues() -> None:
    assert health_score([], 10) == 100.0


def test_score_is_zero_without_pages() -> None:
    assert health_score([], 0) == 0.0


def test_score_weights_by_severity() -> None:
    # One critical issue on one of ten pages: 10 / (10 * 20) of the maximum penalty.
    assert health_score([issue("noindex_in_sitemap", "critical")], 10) == 95.0
    assert health_score([issue("title_missing", "high")], 10) == 97.5
    assert health_score([issue("thin_content", "medium")], 10) == 99.0
    assert health_score([issue("title_too_long", "low")], 10) == 99.8


def test_page_penalty_is_capped() -> None:
    many = [issue("noindex_in_sitemap", "critical") for _ in range(5)]
    assert health_score(many, 1) == 0.0
    assert health_score(many, 2) == 50.0


def test_score_counts_issue_only_urls_as_pages() -> None:
    issues = [issue("sitemap_url_error", "high", f"/gone-{index}/") for index in range(4)]
    assert health_score(issues, 2) == pytest.approx(100 * (1 - 20 / 80))


def test_more_issues_never_raise_the_score() -> None:
    base = [issue("thin_content", "medium", "/a/")]
    worse = [*base, issue("title_missing", "high", "/b/")]
    assert health_score(worse, 10) < health_score(base, 10)


ISSUES = [
    issue("noindex_in_sitemap", "critical", "/p/"),
    issue("title_missing", "high", "/a/"),
    issue("title_missing", "high", "/b/"),
    issue("thin_content", "medium", "/c/"),
    issue("title_too_long", "low", "/d/"),
    issue("title_too_long", "low", "/e/"),
]


def test_heuristic_summary_orders_by_impact() -> None:
    summary = heuristic_summary(ISSUES, 20, 91.0)
    assert "91/100" in summary.headline
    assert "6 issues" in summary.headline
    assert "3 of them critical or high" in summary.headline
    titles = [priority.title for priority in summary.priorities]
    # Two highs (10) tie with one critical (10); ties break alphabetically by rule name.
    assert titles[:2] == ["Noindex on a page listed in the sitemap", "Missing title tag"]
    assert summary.quick_wins
    assert summary.quick_wins[0].startswith("Title too long on 2 page(s)")


def test_heuristic_summary_without_issues() -> None:
    summary = heuristic_summary([], 12, 100.0)
    assert "No issues found across 12 pages" in summary.headline


def test_summary_text_rendering() -> None:
    text = heuristic_summary(ISSUES, 20, 91.0).to_text()
    assert "Priorities" in text
    assert "1. " in text
    assert "Quick wins" in text


def test_prompt_lists_rules_with_counts_and_examples() -> None:
    prompt = build_prompt(ISSUES, 20, 91.0)
    assert "20 pages crawled" in prompt
    assert f"Missing title tag | high | 2 | {SITE}/a/" in prompt


class JsonProvider:
    name = "json"

    def __init__(self, reply: str) -> None:
        self.reply = reply

    def complete(self, prompt: str, *, system: str | None = None, max_tokens: int = 1024) -> str:
        return self.reply


def test_summarise_uses_valid_llm_output() -> None:
    reply = json.dumps(
        {
            "headline": "Fix indexing first.",
            "priorities": [
                {"title": "Noindex", "why": "Page is hidden.", "action": "Remove the tag."}
            ],
            "quick_wins": ["Shorten two titles."],
        }
    )
    result = summarise(JsonProvider(reply), ISSUES, 20, 91.0)
    assert result.source == "llm"
    assert result.value.headline == "Fix indexing first."


def test_summarise_falls_back_when_the_reply_is_unusable() -> None:
    result = summarise(JsonProvider('{"headline": "x"}'), ISSUES, 20, 91.0)
    assert result.source == "heuristic"
    assert isinstance(result.value, AuditSummary)


def _report() -> AuditReport:
    crawl = CrawlResult(site_url=SITE)
    for path in ("/a/", "/p/"):
        url = f"{SITE}{path}"
        fetch = Fetch(url=url, status=200, final_url=url, chain=(url,), elapsed_ms=50)
        crawl.pages[url] = Page(url=url, fetch=fetch, titles=["T"], word_count=300)
    now = datetime(2026, 6, 1, 6, 0, tzinfo=UTC)
    return AuditReport(
        site_url=SITE,
        started_at=now,
        finished_at=now,
        crawl=crawl,
        issues=ISSUES,
        health_score=91.0,
        summary=heuristic_summary(ISSUES, 2, 91.0),
        summary_source="heuristic",
    )


def test_audit_payload_shape() -> None:
    payload = audit_payload(_report())
    assert payload["pages_crawled"] == 2
    assert payload["health_score"] == 91.0
    assert payload["summary_source"] == "heuristic"
    assert len(payload["issues"]) == 6
    assert payload["issues"][0] == {
        "url": f"{SITE}/p/",
        "rule": "noindex_in_sitemap",
        "severity": "critical",
        "message": "noindex_in_sitemap found",
        "details": {},
    }
    assert payload["pages"][0] == {
        "url": f"{SITE}/a/",
        "status_code": 200,
        "word_count": 300,
        "title": "T",
    }
    json.dumps(payload)  # must be serialisable as-is


def test_task_payload_carries_dedupe_key_and_links() -> None:
    payload = task_payload(issue("title_missing", "high", "/stores/boulder/"), 77, 12)
    assert payload["title"] == "Missing title tag: /stores/boulder/"
    assert payload["dedupe_key"] == f"audit:title_missing:{SITE}/stores/boulder/"
    assert (payload["priority"], payload["source"]) == ("high", "audit")
    assert (payload["audit_issue_id"], payload["page_id"]) == (77, 12)
    assert task_payload(issue("noindex_in_sitemap", "critical"), 1, None)["priority"] == "urgent"


def test_publish_posts_the_run_then_tasks_for_high_severity_only() -> None:
    posted: list[tuple[str, dict]] = []
    existing_keys = {f"audit:title_missing:{SITE}/a/"}

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        posted.append((request.url.path, body))
        assert request.headers["authorization"] == "Bearer secret"
        if request.url.path.endswith("/audits"):
            issues = [
                {
                    "id": index,
                    "rule": item["rule"],
                    "url": item["url"],
                    "page_id": None,
                    # The API carries "ignored" over from the previous run.
                    "status": "ignored" if item["url"].endswith("/b/") else "open",
                }
                for index, item in enumerate(body["issues"], start=100)
            ]
            return httpx.Response(
                201, json={"data": {"run": {"id": 9}, "issues": issues}, "meta": {}}
            )
        duplicate = body["dedupe_key"] in existing_keys
        return httpx.Response(
            200 if duplicate else 201,
            json={"data": {"id": 1}, "meta": {"deduplicated": duplicate}},
        )

    api = PlatformApi(
        "http://app.test", "secret", client=httpx.Client(transport=httpx.MockTransport(handler))
    )
    result = publish(api, _report())
    task_bodies = [body for path, body in posted if path.endswith("/tasks")]
    assert (result.run_id, result.issues) == (9, 6)
    # critical /p/ and high /a/ get tasks; high /b/ is ignored; medium and low never do.
    assert [body["dedupe_key"].split(":")[1] for body in task_bodies] == [
        "noindex_in_sitemap",
        "title_missing",
    ]
    assert task_bodies[0]["audit_issue_id"] == 100
    assert (result.tasks_created, result.tasks_existing) == (1, 1)


def test_offline_provider_is_enough_for_summarise() -> None:
    assert summarise(OfflineProvider(), ISSUES, 20, 91.0).source == "heuristic"
    with pytest.raises(LLMError):
        OfflineProvider().complete("anything")
