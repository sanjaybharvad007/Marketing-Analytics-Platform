"""Run an audit end to end and publish it through the platform API."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

import httpx

from map_pipelines.api_client import PlatformApi
from map_pipelines.audit.crawler import Crawler
from map_pipelines.audit.rules import RULES, AuditConfig, run_rules
from map_pipelines.audit.score import health_score
from map_pipelines.audit.site import CrawlResult, Issue
from map_pipelines.audit.summary import AuditSummary, summarise
from map_pipelines.llm import LLMProvider
from map_pipelines.logs import get_logger

log = get_logger("audit")

TASK_SEVERITIES = ("critical", "high")
_TASK_PRIORITY = {"critical": "urgent", "high": "high"}


@dataclass(frozen=True)
class AuditReport:
    site_url: str
    started_at: datetime
    finished_at: datetime
    crawl: CrawlResult
    issues: list[Issue]
    health_score: float
    summary: AuditSummary
    summary_source: str

    @property
    def pages_crawled(self) -> int:
        return len(self.crawl.pages)


@dataclass(frozen=True)
class PublishResult:
    run_id: int
    issues: int
    tasks_created: int
    tasks_existing: int


async def run_audit(
    base_url: str,
    provider: LLMProvider,
    *,
    public_origin: str | None = None,
    client: httpx.AsyncClient | None = None,
    config: AuditConfig | None = None,
    concurrency: int = 5,
    max_pages: int = 500,
) -> AuditReport:
    """Crawl `base_url`, apply the rules, score the site and summarise the findings."""
    started = datetime.now(UTC)
    owns_client = client is None
    client = client or httpx.AsyncClient()
    try:
        crawler = Crawler(
            base_url,
            client,
            public_origin=public_origin,
            concurrency=concurrency,
            max_pages=max_pages,
        )
        crawl = await crawler.crawl()
    finally:
        if owns_client:
            await client.aclose()

    issues = run_rules(crawl, config)
    score = health_score(issues, len(crawl.pages))
    summary = summarise(provider, issues, len(crawl.pages), score)
    return AuditReport(
        site_url=crawl.site_url,
        started_at=started,
        finished_at=datetime.now(UTC),
        crawl=crawl,
        issues=issues,
        health_score=score,
        summary=summary.value,
        summary_source=summary.source,
    )


def audit_payload(report: AuditReport) -> dict[str, Any]:
    """Body for POST /api/v1/audits."""
    return {
        "site_url": report.site_url,
        "started_at": report.started_at.isoformat(),
        "finished_at": report.finished_at.isoformat(),
        "pages_crawled": report.pages_crawled,
        "health_score": report.health_score,
        "summary": report.summary.to_text(),
        "summary_source": report.summary_source,
        "issues": [
            {
                "url": issue.url,
                "rule": issue.rule,
                "severity": issue.severity,
                "message": issue.message,
                "details": issue.details,
            }
            for issue in report.issues
        ],
        "pages": [
            {
                "url": page.url,
                "status_code": page.fetch.status,
                "word_count": page.word_count,
                "title": page.title,
            }
            for page in report.crawl.pages.values()
        ],
    }


def task_payload(issue: Issue, issue_id: int | None, page_id: int | None) -> dict[str, Any]:
    """Body for POST /api/v1/tasks for one high-severity issue."""
    info = RULES[issue.rule]
    path = urlsplit(issue.url).path or "/"
    return {
        "title": f"{info.title}: {path}"[:200],
        "description": f"{issue.message}\n\nSuggested fix: {info.fix}\n\nURL: {issue.url}",
        "status": "todo",
        "priority": _TASK_PRIORITY[issue.severity],
        "labels": ["technical-seo"],
        "source": "audit",
        "dedupe_key": f"audit:{issue.rule}:{issue.url}",
        "audit_issue_id": issue_id,
        "page_id": page_id,
        "evidence": {"rule": issue.rule, "severity": issue.severity, **issue.details},
    }


def publish(
    api: PlatformApi, report: AuditReport, *, task_severities: Sequence[str] = TASK_SEVERITIES
) -> PublishResult:
    """Store the run and its issues, then open one task per high-severity issue.

    Tasks carry a dedupe key built from the rule and URL, so an issue that
    persists across audits keeps its original task instead of spawning new ones.
    """
    result = api.post("audits", audit_payload(report)).data
    stored = {(row["rule"], row["url"]): row for row in result["issues"]}

    created = existing = 0
    for issue in report.issues:
        if issue.severity not in task_severities:
            continue
        row = stored.get((issue.rule, issue.url), {})
        if row.get("status") == "ignored":
            continue
        response = api.post("tasks", task_payload(issue, row.get("id"), row.get("page_id")))
        if response.meta.get("deduplicated"):
            existing += 1
        else:
            created += 1
    log.info(
        "audit published",
        extra={
            "run_id": result["run"]["id"],
            "issues": len(report.issues),
            "tasks_created": created,
            "tasks_existing": existing,
        },
    )
    return PublishResult(result["run"]["id"], len(report.issues), created, existing)
