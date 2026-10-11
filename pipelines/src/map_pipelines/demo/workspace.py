"""Demo workspace content: team members, content plans, tasks, saved views and audit history.

Seeding writes these tables directly because it bootstraps an empty database;
everything that runs afterwards (audits, briefs, opportunities) goes through
the REST API.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

import httpx
import psycopg
from psycopg.types.json import Jsonb

from map_pipelines import demo_site
from map_pipelines.audit.rules import RULES
from map_pipelines.audit.runner import TASK_SEVERITIES, AuditReport, run_audit, task_payload
from map_pipelines.audit.score import health_score
from map_pipelines.audit.site import Issue
from map_pipelines.audit.summary import heuristic_summary
from map_pipelines.briefs.builder import (
    BriefInputs,
    CandidatePage,
    Intent,
    RankingSnapshot,
    RelatedQuery,
    heuristic_brief,
)
from map_pipelines.demo.world import DemoWorld
from map_pipelines.llm import OfflineProvider

MEMBERS = (
    ("Maya Okafor", "maya.okafor@northpeak.example", "Head of Marketing", "#3b6fb6"),
    ("Daniel Reyes", "daniel.reyes@northpeak.example", "SEO Lead", "#2f7d6d"),
    ("Priya Natarajan", "priya.natarajan@northpeak.example", "Content Strategist", "#8a5a9e"),
    ("Tom Lindqvist", "tom.lindqvist@northpeak.example", "Technical SEO", "#b0652f"),
    ("Aiko Tanaka", "aiko.tanaka@northpeak.example", "Content Writer", "#a14d6b"),
    ("Sam Whitfield", "sam.whitfield@northpeak.example", "Web Developer", "#5c6b7a"),
)


@dataclass(frozen=True)
class PlanSeed:
    title: str
    keyword: str
    intent: Intent
    page_type: str
    status: str
    priority: str
    owner: str
    target_path: str
    traffic: int
    due_in_days: int | None
    brief: str = "none"  # none | requested | ready
    notes: str = ""
    existing: bool = False


PLANS: tuple[PlanSeed, ...] = (
    PlanSeed(
        "Refresh: Best Backpacking Tents for 2026",
        "best backpacking tents",
        "commercial",
        "article",
        "brief",
        "urgent",
        "Priya Natarajan",
        "/blog/best-backpacking-tents-2025/",
        4200,
        9,
        brief="ready",
        notes="Title still says 2025 and clicks have dropped for six weeks. Retest the top five "
        "tents, update prices and move the URL to an evergreen slug.",
        existing=True,
    ),
    PlanSeed(
        "Winter Camping Checklist rewrite",
        "winter camping checklist",
        "informational",
        "article",
        "draft",
        "high",
        "Aiko Tanaka",
        "/blog/winter-camping-checklist/",
        2600,
        16,
        brief="ready",
        notes="Competing checklists now include a printable PDF and sleep-system advice.",
        existing=True,
    ),
    PlanSeed(
        "Sleeping Bag Buying Guide",
        "how to choose a sleeping bag",
        "informational",
        "guide",
        "brief",
        "high",
        "Priya Natarajan",
        "/guides/how-to-choose-a-sleeping-bag/",
        3100,
        23,
        brief="requested",
        notes="We rank for temperature ratings but have no top-level buying guide. "
        "Summit & Co owns this topic in AI answers.",
    ),
    PlanSeed(
        "Hiking Boots category copy",
        "hiking boots",
        "commercial",
        "category",
        "review",
        "high",
        "Daniel Reyes",
        "/categories/hiking-boots/",
        5200,
        5,
        notes="Striking distance for the head term. Add a fit selector and 300 words of "
        "buying advice above the grid.",
        existing=True,
    ),
    PlanSeed(
        "Gear Repair Hub",
        "outdoor gear repair",
        "informational",
        "guide",
        "idea",
        "medium",
        "Priya Natarajan",
        "/guides/gear-repair/",
        1800,
        None,
        brief="requested",
        notes="Would support the trade-in programme and the sustainability prompts we are "
        "missing from in AI answers.",
    ),
    PlanSeed(
        "Ultralight Tent Comparison",
        "ultralight 1 person tent",
        "commercial",
        "article",
        "idea",
        "medium",
        "Aiko Tanaka",
        "/blog/ultralight-tent-comparison/",
        1400,
        None,
        notes="Supports the Skyline UL 1P launch.",
    ),
    PlanSeed(
        "Skyline UL 1P launch page polish",
        "skyline ul 1p tent",
        "transactional",
        "product",
        "published",
        "high",
        "Sam Whitfield",
        "/products/skyline-ul-1p-tent/",
        900,
        -38,
        notes="Launched. Follow up with review schema once the first reviews arrive.",
        existing=True,
    ),
    PlanSeed(
        "Rain Jacket Waterproof Ratings: add comparison table",
        "rain jacket waterproof rating",
        "informational",
        "guide",
        "scheduled",
        "medium",
        "Aiko Tanaka",
        "/guides/rain-jacket-waterproof-ratings/",
        1600,
        3,
        notes="Scheduled with the autumn rainwear campaign.",
        existing=True,
    ),
    PlanSeed(
        "Backpacking Stove Buying Guide",
        "best backpacking stove",
        "commercial",
        "guide",
        "idea",
        "low",
        "Priya Natarajan",
        "/guides/how-to-choose-a-backpacking-stove/",
        1200,
        None,
    ),
    PlanSeed(
        "Trekking Poles category FAQ",
        "trekking poles",
        "commercial",
        "category",
        "draft",
        "medium",
        "Daniel Reyes",
        "/categories/trekking-poles/",
        1900,
        19,
        notes="Add FAQ block answering length and carbon vs aluminium.",
        existing=True,
    ),
    PlanSeed(
        "Best Day Hikes near Seattle",
        "best day hikes near seattle",
        "informational",
        "article",
        "idea",
        "low",
        "Aiko Tanaka",
        "/blog/best-day-hikes-near-seattle/",
        1500,
        None,
        notes="The Denver version brings steady store-page traffic; repeat for Seattle.",
    ),
    PlanSeed(
        "Trade-In Programme explainer",
        "used outdoor gear",
        "commercial",
        "landing",
        "review",
        "medium",
        "Maya Okafor",
        "/trade-in/",
        1100,
        8,
        notes="Orphaned in the last audit. Needs links from category pages and the footer.",
        existing=True,
    ),
    PlanSeed(
        "Backpack Fit Guide: add torso-length calculator",
        "how to measure torso length",
        "informational",
        "guide",
        "published",
        "medium",
        "Sam Whitfield",
        "/guides/how-to-fit-a-backpack/",
        2300,
        -21,
        existing=True,
    ),
    PlanSeed(
        "Down vs Synthetic: update for 2026 fill standards",
        "down vs synthetic sleeping bag",
        "commercial",
        "article",
        "scheduled",
        "low",
        "Aiko Tanaka",
        "/blog/down-vs-synthetic-sleeping-bags/",
        1700,
        12,
        existing=True,
    ),
    PlanSeed(
        "Holiday Gift Guide 2026",
        "gifts for hikers",
        "commercial",
        "landing",
        "brief",
        "high",
        "Maya Okafor",
        "/gift-guide/",
        3800,
        30,
        notes="Needs to be live six weeks before peak. Reuse last year's URL.",
        existing=True,
    ),
    PlanSeed(
        "Denver store page: events and workshops",
        "outdoor store denver",
        "transactional",
        "store",
        "draft",
        "low",
        "Sam Whitfield",
        "/stores/denver/",
        600,
        26,
        existing=True,
    ),
)


@dataclass(frozen=True)
class TaskSeed:
    title: str
    status: str
    priority: str
    assignee: str | None
    due_in_days: int | None
    labels: tuple[str, ...]
    description: str = ""
    plan: str | None = None  # plan title
    page: str | None = None  # page path
    source: str = "manual"


TASKS: tuple[TaskSeed, ...] = (
    TaskSeed(
        "Retest top five tents for the 2026 roundup",
        "in_progress",
        "urgent",
        "Aiko Tanaka",
        4,
        ("content", "refresh"),
        "Field notes and new photos for each tent. Prices checked on the day of publishing.",
        plan="Refresh: Best Backpacking Tents for 2026",
        page="/blog/best-backpacking-tents-2025/",
    ),
    TaskSeed(
        "Plan 301 from /blog/best-backpacking-tents-2025/ to evergreen slug",
        "todo",
        "high",
        "Tom Lindqvist",
        7,
        ("technical-seo", "redirects"),
        plan="Refresh: Best Backpacking Tents for 2026",
        page="/blog/best-backpacking-tents-2025/",
    ),
    TaskSeed(
        "Write buying advice block for hiking boots category",
        "review",
        "high",
        "Aiko Tanaka",
        2,
        ("content", "category"),
        plan="Hiking Boots category copy",
        page="/categories/hiking-boots/",
    ),
    TaskSeed(
        "Build boot fit selector component",
        "in_progress",
        "medium",
        "Sam Whitfield",
        6,
        ("dev",),
        plan="Hiking Boots category copy",
        page="/categories/hiking-boots/",
    ),
    TaskSeed(
        "Add printable PDF to winter camping checklist",
        "todo",
        "medium",
        "Priya Natarajan",
        11,
        ("content",),
        plan="Winter Camping Checklist rewrite",
        page="/blog/winter-camping-checklist/",
    ),
    TaskSeed(
        "Interview repair technician for gear repair hub",
        "backlog",
        "low",
        "Priya Natarajan",
        None,
        ("content", "research"),
        plan="Gear Repair Hub",
    ),
    TaskSeed(
        "Add Product schema with reviews to Skyline UL 1P",
        "todo",
        "medium",
        "Sam Whitfield",
        9,
        ("technical-seo", "schema"),
        plan="Skyline UL 1P launch page polish",
        page="/products/skyline-ul-1p-tent/",
    ),
    TaskSeed(
        "Link trade-in page from category footers",
        "todo",
        "medium",
        "Tom Lindqvist",
        -2,
        ("technical-seo", "internal-links"),
        "The page is in the sitemap but nothing links to it.",
        plan="Trade-In Programme explainer",
        page="/trade-in/",
    ),
    TaskSeed(
        "Comparison table for waterproof ratings guide",
        "done",
        "medium",
        "Aiko Tanaka",
        -4,
        ("content",),
        plan="Rain Jacket Waterproof Ratings: add comparison table",
        page="/guides/rain-jacket-waterproof-ratings/",
    ),
    TaskSeed(
        "FAQ copy for trekking poles category",
        "in_progress",
        "medium",
        "Aiko Tanaka",
        13,
        ("content", "category"),
        plan="Trekking Poles category FAQ",
        page="/categories/trekking-poles/",
    ),
    TaskSeed(
        "Shortlist products for holiday gift guide",
        "todo",
        "high",
        "Maya Okafor",
        14,
        ("merchandising",),
        plan="Holiday Gift Guide 2026",
        page="/gift-guide/",
    ),
    TaskSeed(
        "Photography brief for gift guide hero",
        "backlog",
        "medium",
        "Maya Okafor",
        20,
        ("creative",),
        plan="Holiday Gift Guide 2026",
    ),
    TaskSeed(
        "Torso-length calculator QA on mobile",
        "done",
        "medium",
        "Sam Whitfield",
        -19,
        ("dev", "qa"),
        plan="Backpack Fit Guide: add torso-length calculator",
        page="/guides/how-to-fit-a-backpack/",
    ),
    TaskSeed(
        "Review title tags for sleeping bag products",
        "backlog",
        "medium",
        "Daniel Reyes",
        None,
        ("seo", "on-page"),
        page="/categories/sleeping-bags/",
    ),
    TaskSeed(
        "Quarterly keyword list review",
        "todo",
        "low",
        "Daniel Reyes",
        18,
        ("seo", "process"),
        "Drop keywords with no impressions in 90 days and add terms from the planner.",
    ),
    TaskSeed(
        "Set up Search Console access for the agency",
        "done",
        "low",
        "Tom Lindqvist",
        -12,
        ("ops",),
    ),
    TaskSeed(
        "Fix slow response on Basecamp 4P product page",
        "todo",
        "high",
        "Sam Whitfield",
        -1,
        ("dev", "performance"),
        "Template renders the full review list server-side; paginate or cache it.",
        page="/products/basecamp-4p-tent/",
    ),
    TaskSeed(
        "Draft October newsletter",
        "review",
        "medium",
        "Maya Okafor",
        1,
        ("email",),
    ),
    TaskSeed(
        "Brief freelance writer on Seattle day hikes",
        "backlog",
        "low",
        "Priya Natarajan",
        None,
        ("content",),
        plan="Best Day Hikes near Seattle",
    ),
    TaskSeed(
        "Update Denver store hours and events",
        "in_progress",
        "low",
        "Sam Whitfield",
        10,
        ("local",),
        plan="Denver store page: events and workshops",
        page="/stores/denver/",
    ),
    TaskSeed(
        "Compare our sleeping bag pages with Summit & Co",
        "todo",
        "medium",
        "Daniel Reyes",
        5,
        ("seo", "competitors", "ai-visibility"),
        "They are named in most AI answers about sleeping bags and we are not. Document what "
        "their pages cover that ours do not.",
        plan="Sleeping Bag Buying Guide",
    ),
    TaskSeed(
        "Add alt text to product gallery images",
        "backlog",
        "low",
        "Aiko Tanaka",
        None,
        ("accessibility", "on-page"),
    ),
)

SAVED_VIEWS: tuple[tuple[str, str, dict[str, Any]], ...] = (
    (
        "Non-brand striking distance",
        "seo",
        {
            "tab": "queries",
            "range": "28d",
            "compare": "previous",
            "brand": "non_brand",
            "position": ["11-20"],
            "min_impressions": 300,
            "sort": "impressions",
            "dir": "desc",
        },
    ),
    (
        "US mobile: guides",
        "seo",
        {
            "tab": "pages",
            "range": "28d",
            "compare": "previous",
            "country": ["US"],
            "device": ["mobile"],
            "section": ["guides"],
            "sort": "clicks",
            "dir": "desc",
        },
    ),
    (
        "Tent queries, last 90 days",
        "seo",
        {"tab": "queries", "range": "90d", "compare": "previous", "q": "tent", "sort": "clicks"},
    ),
)

# Issues that existed in earlier audits and have since been fixed, so the run
# history shows the health score improving. (rule, path, message, fixed after N runs)
_RESOLVED_ISSUES: tuple[tuple[str, str, str, int], ...] = (
    ("title_missing", "/categories/headlamps/", "The page has no <title>.", 1),
    (
        "broken_internal_link",
        "/guides/hiking-boot-sizing/",
        "2 internal link(s) return an error.",
        1,
    ),
    ("canonical_missing", "/categories/camp-stoves/", "The page has no rel=canonical link.", 1),
    ("h1_missing", "/products/daybreak-22-daypack/", "The page has no H1 heading.", 2),
    (
        "meta_description_missing",
        "/blog/camp-coffee-methods/",
        "The page has no meta description.",
        2,
    ),
    ("thin_content", "/stores/seattle/", "Only 120 words of main content.", 2),
    (
        "noindex_in_sitemap",
        "/guides/layering-for-cold-weather/",
        "The page is in the sitemap but carries a noindex directive.",
        3,
    ),
    (
        "image_alt_missing",
        "/products/cairn-mid-hiking-boot/",
        "4 image(s) have no alt attribute.",
        3,
    ),
    ("insecure_link", "/blog/hiking-with-dogs-tips/", "1 link(s) use http://.", 3),
)
AUDIT_HISTORY_RUNS = 4


def _due(anchor: date, offset: int | None) -> date | None:
    return None if offset is None else anchor + timedelta(days=offset)


def _demo_brief(world: DemoWorld, plan: PlanSeed) -> dict[str, Any]:
    """Run the heuristic brief builder on the demo catalogue."""
    related = [
        RelatedQuery(
            query.query, impressions=round(query.demand * 28), position=query.base_position
        )
        for query in world.queries
    ]
    pages = [
        CandidatePage(
            url=world.url(page),
            title=page.title,
            clicks=round(world.expected_organic_clicks(page) * 28),
            page_type=world.page_class(page).page_type,
        )
        for page in world.pages
    ]
    tracked = next((query for query in world.queries if query.query == plan.keyword), None)
    brief = heuristic_brief(
        BriefInputs(
            title=plan.title,
            target_keyword=plan.keyword,
            intent=plan.intent,
            page_type=plan.page_type,
            target_url=f"{world.site_url}{plan.target_path}",
            related_queries=related,
            candidate_pages=pages,
            ranking=RankingSnapshot(
                position=round(tracked.base_position, 1) if tracked else None,
                url=world.url(tracked.page) if tracked else None,
                search_volume=round(tracked.demand * 30 / 0.55, -1) if tracked else None,
            ),
            brand_name="Northpeak Outfitters",
        )
    )
    return {**brief.model_dump(mode="json"), "generated_by": "heuristic"}


def crawl_demo_site(world: DemoWorld) -> AuditReport:
    """Audit the bundled demo site in-process (no socket)."""

    async def crawl() -> AuditReport:
        site = demo_site.StaticSite()
        async with httpx.AsyncClient(transport=demo_site.transport(site)) as client:
            return await run_audit(
                "http://demo-site.internal/",
                OfflineProvider(),
                public_origin=world.site_url,
                client=client,
            )

    return asyncio.run(crawl())


def _insert_audit_run(
    conn: psycopg.Connection,
    report: AuditReport,
    issues: list[tuple[Issue, str]],
    finished: datetime,
    summary: str,
) -> dict[tuple[str, str], int]:
    score = health_score([issue for issue, _ in issues], report.pages_crawled)
    run_id = conn.execute(
        """
        INSERT INTO audit_runs (site_url, started_at, finished_at, pages_crawled, issues_total,
                                health_score, summary, summary_source, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, 'heuristic', %s)
        RETURNING id
        """,
        (
            report.site_url,
            finished - timedelta(seconds=41),
            finished,
            report.pages_crawled,
            len(issues),
            score,
            summary,
            finished,
        ),
    ).fetchone()[0]
    ids: dict[tuple[str, str], int] = {}
    for issue, status in issues:
        issue_id = conn.execute(
            """
            INSERT INTO audit_issues (run_id, page_id, url, rule, severity, message, details,
                                      status, created_at, updated_at)
            VALUES (%s, (SELECT id FROM pages WHERE url = %s), %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                run_id,
                issue.url,
                issue.url,
                issue.rule,
                issue.severity,
                issue.message,
                Jsonb(json.loads(json.dumps(issue.details, default=str))),
                status,
                finished,
                finished,
            ),
        ).fetchone()[0]
        ids[(issue.rule, issue.url)] = issue_id
    return ids


def seed_audit_history(conn: psycopg.Connection, world: DemoWorld) -> int:
    """Insert weekly audit runs ending a week before the anchor.

    The newest run is exactly what the rule engine finds on the demo site.
    Older runs add issues that were fixed along the way.
    """
    report = crawl_demo_site(world)
    latest_ids: dict[tuple[str, str], int] = {}
    for index in range(AUDIT_HISTORY_RUNS):
        weeks_ago = AUDIT_HISTORY_RUNS - index
        finished = datetime.combine(
            world.anchor - timedelta(days=7 * weeks_ago), time(6, 30), tzinfo=UTC
        )
        legacy = [
            Issue(rule, RULES[rule].severity, f"{world.site_url}{path}", message)
            for rule, path, message, fixed_after in _RESOLVED_ISSUES
            if fixed_after > index
        ]
        issues = [(issue, "open") for issue in report.issues] + [
            (issue, "fixed") for issue in legacy
        ]
        all_issues = [issue for issue, _ in issues]
        summary = heuristic_summary(
            all_issues, report.pages_crawled, health_score(all_issues, report.pages_crawled)
        ).to_text()
        latest_ids = _insert_audit_run(conn, report, issues, finished, summary)

    # Crawled facts flow back onto the page inventory, as POST /audits does.
    for page in report.crawl.pages.values():
        conn.execute(
            "UPDATE pages SET status_code = %s WHERE url = %s", (page.fetch.status, page.url)
        )
    _seed_audit_tasks(conn, world, report, latest_ids)
    return AUDIT_HISTORY_RUNS


def _seed_audit_tasks(
    conn: psycopg.Connection,
    world: DemoWorld,
    report: AuditReport,
    issue_ids: dict[tuple[str, str], int],
) -> None:
    """Open tasks for the critical and high issues, as `map audit` would."""
    assignee = conn.execute(
        "SELECT id FROM members WHERE email = %s", ("tom.lindqvist@northpeak.example",)
    ).fetchone()
    order = conn.execute("SELECT COALESCE(max(sort_order), 0) FROM tasks").fetchone()[0]
    for issue in report.issues:
        if issue.severity not in TASK_SEVERITIES:
            continue
        payload = task_payload(issue, issue_ids.get((issue.rule, issue.url)), None)
        order += 1000
        conn.execute(
            """
            INSERT INTO tasks (title, description, status, priority, assignee_id, due_date, labels,
                               sort_order, page_id, audit_issue_id, source, dedupe_key, evidence)
            VALUES (%s, %s, 'todo', %s, %s, %s, %s, %s,
                    (SELECT id FROM pages WHERE url = %s), %s, 'audit', %s, %s)
            ON CONFLICT (dedupe_key) DO NOTHING
            """,
            (
                payload["title"],
                payload["description"],
                payload["priority"],
                assignee[0] if assignee else None,
                world.anchor + timedelta(days=7),
                payload["labels"],
                order,
                issue.url,
                payload["audit_issue_id"],
                payload["dedupe_key"],
                Jsonb(json.loads(json.dumps(payload["evidence"], default=str))),
            ),
        )


def seed_workspace(conn: psycopg.Connection, world: DemoWorld) -> dict[str, int]:
    """Insert members, plans, tasks and saved views. Expects those tables to be empty."""
    anchor = world.anchor
    member_ids: dict[str, int] = {}
    for name, email, role, color in MEMBERS:
        member_ids[name] = conn.execute(
            "INSERT INTO members (name, email, role, color) VALUES (%s, %s, %s, %s) RETURNING id",
            (name, email, role, color),
        ).fetchone()[0]

    page_ids = dict(conn.execute("SELECT path, id FROM pages").fetchall())
    plan_ids: dict[str, int] = {}
    for index, plan in enumerate(PLANS):
        brief = _demo_brief(world, plan) if plan.brief == "ready" else None
        created = datetime.combine(anchor - timedelta(days=60 - index * 3), time(10, 0), tzinfo=UTC)
        plan_ids[plan.title] = conn.execute(
            """
            INSERT INTO content_plans
                (title, target_keyword, intent, page_type, status, priority, owner_id, target_url,
                 page_id, est_monthly_traffic, due_date, brief, brief_status, brief_updated_at,
                 notes, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                plan.title,
                plan.keyword,
                plan.intent,
                plan.page_type,
                plan.status,
                plan.priority,
                member_ids[plan.owner],
                f"{world.site_url}{plan.target_path}",
                page_ids.get(plan.target_path) if plan.existing else None,
                plan.traffic,
                _due(anchor, plan.due_in_days),
                Jsonb(brief) if brief else None,
                plan.brief,
                created + timedelta(days=2) if brief else None,
                plan.notes or None,
                created,
            ),
        ).fetchone()[0]

    order_by_status: dict[str, float] = {}
    for task in TASKS:
        order_by_status[task.status] = order_by_status.get(task.status, 0.0) + 1000.0
        completed = (
            datetime.combine(_due(anchor, task.due_in_days) or anchor, time(15, 0), tzinfo=UTC)
            if task.status == "done"
            else None
        )
        conn.execute(
            """
            INSERT INTO tasks (title, description, status, priority, assignee_id, due_date, labels,
                               sort_order, plan_id, page_id, source, completed_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                task.title,
                task.description or None,
                task.status,
                task.priority,
                member_ids.get(task.assignee) if task.assignee else None,
                _due(anchor, task.due_in_days),
                list(task.labels),
                order_by_status[task.status],
                plan_ids.get(task.plan) if task.plan else None,
                page_ids.get(task.page) if task.page else None,
                task.source,
                completed,
            ),
        )

    for name, report, filters in SAVED_VIEWS:
        conn.execute(
            "INSERT INTO saved_views (name, report, filters) VALUES (%s, %s, %s)",
            (name, report, Jsonb(filters)),
        )
    return {
        "members": len(MEMBERS),
        "plans": len(PLANS),
        "tasks": len(TASKS),
        "saved_views": len(SAVED_VIEWS),
    }
