/**
 * Service-level tests against a real PostgreSQL database with a small,
 * hand-computed fixture. They exercise the same functions the pages and the
 * REST handlers call.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type * as DbClient from "@/db/client";
import { ApiError, fromDatabaseError } from "@/lib/api/errors";
import type { TaskCreate } from "@/lib/api/schemas";
import type { ResolvedPeriods } from "@/lib/dates";
import { parseSeoPageState, type SeoFilters } from "@/lib/filters/seo";
import { describeDb, resetDatabase } from "@/test/database";

const CURRENT = { from: "2026-06-22", to: "2026-06-28" };
const PREVIOUS = { from: "2026-06-15", to: "2026-06-21" };
const COMPARED: ResolvedPeriods = { current: CURRENT, previous: PREVIOUS };
const SITE = "https://www.northpeak.example";

function filters(query = ""): SeoFilters {
  return parseSeoPageState(new URLSearchParams(query));
}

describeDb("services against PostgreSQL", () => {
  let db: typeof DbClient.db;
  let client: typeof DbClient.client;

  beforeAll(async () => {
    await resetDatabase();
    ({ db, client } = await import("@/db/client"));
    await db.execute(sql`
      INSERT INTO pages (url, path, title, section, page_type) VALUES
        (${`${SITE}/guides/tents/`}, '/guides/tents/', 'Tent Guide', 'guides', 'guide'),
        (${`${SITE}/blog/boots/`}, '/blog/boots/', 'Best Boots', 'blog', 'article'),
        (${`${SITE}/`}, '/', 'Home', 'landing', 'home')
    `);
    await db.execute(sql`
      INSERT INTO gsc_daily (date, page_id, query, country, device, clicks, impressions, sum_position, is_brand) VALUES
        ('2026-06-28', 1, 'how to choose a tent', 'US', 'mobile', 10, 200, 1600, false),
        ('2026-06-27', 1, 'how to choose a tent', 'CA', 'desktop', 5, 100, 1200, false),
        ('2026-06-28', 1, 'tent footprint', 'US', 'mobile', 2, 400, 6000, false),
        ('2026-06-28', 2, 'best hiking boots', 'US', 'desktop', 30, 300, 900, false),
        ('2026-06-28', 3, 'northpeak', 'US', 'mobile', 50, 100, 100, true),
        ('2026-06-20', 1, 'how to choose a tent', 'US', 'mobile', 4, 100, 1000, false),
        ('2026-06-20', 2, 'best hiking boots', 'US', 'desktop', 40, 320, 800, false),
        ('2026-06-20', 3, 'northpeak', 'US', 'mobile', 45, 90, 90, true),
        ('2026-06-20', 2, 'old query', 'US', 'mobile', 3, 30, 600, false)
    `);
    await db.execute(sql`
      INSERT INTO ga_daily (date, page_id, channel, device, country, sessions, users, engaged_sessions, conversions, revenue) VALUES
        ('2026-06-28', 1, 'Organic Search', 'mobile', 'US', 100, 90, 60, 2, 0),
        ('2026-06-28', 3, 'Direct', 'desktop', 'US', 50, 45, 20, 1, 124.00),
        ('2026-06-20', 1, 'Organic Search', 'mobile', 'US', 80, 70, 40, 1, 0)
    `);
    await db.execute(sql`
      INSERT INTO ai_prompts (prompt, topic, intent) VALUES
        ('Best tents?', 'Tents', 'commercial'), ('Warmest sleeping bags?', 'Sleeping bags', 'commercial')
    `);
    await db.execute(sql`
      INSERT INTO ai_visibility_results
        (date, prompt_id, engine, brand_mentioned, brand_rank, cited, cited_url, sentiment, competitors_mentioned, answer_excerpt) VALUES
        ('2026-06-28', 1, 'chatgpt', true, 1, true, ${`${SITE}/guides/tents/`}, 'positive', '{}', 'Northpeak is great.'),
        ('2026-06-28', 1, 'claude', true, 2, false, NULL, 'neutral', '{"Summit & Co"}', 'Summit & Co, then Northpeak.'),
        ('2026-06-28', 2, 'chatgpt', false, NULL, false, NULL, NULL, '{"Summit & Co"}', 'Summit & Co.'),
        ('2026-06-28', 2, 'claude', false, NULL, false, NULL, NULL, '{"Summit & Co","TrailForge"}', 'Summit & Co and TrailForge.')
    `);
    await db.execute(sql`
      INSERT INTO members (name, email, role, color)
      VALUES ('Maya Okafor', 'maya@northpeak.example', 'Lead', '#3b6fb6')
    `);
    for (const view of ["mv_traffic_daily", "mv_search_page_daily", "mv_ai_visibility_daily"]) {
      await db.execute(sql.raw(`REFRESH MATERIALIZED VIEW ${view}`));
    }
  });

  afterAll(async () => {
    await client.end();
  });

  describe("SEO queries", () => {
    it("aggregates per query with deltas against the previous period", async () => {
      const { listQueries } = await import("./seo");
      const result = await listQueries(filters(), COMPARED);
      expect(result.total).toBe(4);
      expect(result.sort).toBe("clicks");
      expect(result.rows.map((row) => row.query)).toEqual([
        "northpeak",
        "best hiking boots",
        "how to choose a tent",
        "tent footprint",
      ]);
      const tent = result.rows[2]!;
      expect(tent.clicks).toBe(15);
      expect(tent.impressions).toBe(300);
      expect(tent.ctr).toBeCloseTo(0.05);
      // Impression-weighted: (8 * 200 + 12 * 100) / 300, not the plain mean of 8 and 12.
      expect(tent.position).toBeCloseTo(2800 / 300);
      expect(tent.clicks_prev).toBe(4);
      expect(tent.position_prev).toBeCloseTo(10);
      expect(tent.clicks_delta).toBe(11);
      // New this period: no previous row, so the delta is the full value.
      expect(result.rows[3]).toMatchObject({ clicks_prev: null, clicks_delta: 2 });
    });

    it("returns no previous values without comparison", async () => {
      const { listQueries } = await import("./seo");
      const result = await listQueries(filters(), { current: CURRENT, previous: null });
      expect(result.rows[0]).toMatchObject({ clicks: 50, clicks_prev: null, clicks_delta: null });
    });

    it.each([
      ["brand=non_brand", ["best hiking boots", "how to choose a tent", "tent footprint"]],
      ["brand=brand", ["northpeak"]],
      ["q=tent", ["how to choose a tent", "tent footprint"]],
      ["q=TENT&q_not=footprint", ["how to choose a tent"]],
      ["country=CA", ["how to choose a tent"]],
      ["device=desktop", ["best hiking boots", "how to choose a tent"]],
      ["section=guides", ["how to choose a tent", "tent footprint"]],
      ["page_type=article", ["best hiking boots"]],
      ["url=/blog/", ["best hiking boots"]],
      ["position=11-20", ["tent footprint"]],
      ["position=1-3,11-20", ["northpeak", "best hiking boots", "tent footprint"]],
      ["min_clicks=10", ["northpeak", "best hiking boots", "how to choose a tent"]],
      ["min_impressions=350", ["tent footprint"]],
      ["page_id=1", ["how to choose a tent", "tent footprint"]],
      ["q=100%25", []],
    ])("filter %s", async (query, expected) => {
      const { listQueries } = await import("./seo");
      const result = await listQueries(filters(query), COMPARED);
      expect(result.rows.map((row) => row.query)).toEqual(expected);
      expect(result.total).toBe(expected.length);
    });

    it("applies country filters to the metrics, not just the row set", async () => {
      const { listQueries } = await import("./seo");
      const [row] = (await listQueries(filters("country=CA"), COMPARED)).rows;
      expect(row).toMatchObject({ clicks: 5, impressions: 100, clicks_prev: null });
      expect(row?.position).toBeCloseTo(12);
    });

    it("sorts by allowlisted columns and ignores anything else", async () => {
      const { listQueries } = await import("./seo");
      const byPosition = await listQueries(filters("sort=position&dir=asc"), COMPARED);
      expect(byPosition.rows.map((row) => row.query)).toEqual([
        "northpeak",
        "best hiking boots",
        "how to choose a tent",
        "tent footprint",
      ]);
      const byDelta = await listQueries(filters("sort=clicks_delta&dir=asc"), COMPARED);
      expect(byDelta.rows[0]?.query).toBe("best hiking boots");
      const unknown = await listQueries({ ...filters(), sort: "loaded_at" }, COMPARED);
      expect(unknown.sort).toBe("clicks");
    });

    it("paginates with a stable total", async () => {
      const { listQueries } = await import("./seo");
      const first = await listQueries(filters("page_size=3"), COMPARED);
      const second = await listQueries(filters("page_size=3&page=2"), COMPARED);
      expect(first.rows).toHaveLength(3);
      expect(second.rows.map((row) => row.query)).toEqual(["tent footprint"]);
      expect([first.total, second.total]).toEqual([4, 4]);
    });
  });

  describe("SEO pages and trend", () => {
    it("reads the rollup and matches the query-level table", async () => {
      const { listPages } = await import("./seo");
      const fromRollup = await listPages(filters(), COMPARED);
      expect(fromRollup.rows.map((row) => [row.path, row.clicks, row.clicks_prev])).toEqual([
        ["/", 50, 45],
        ["/blog/boots/", 30, 43],
        ["/guides/tents/", 17, 4],
      ]);
      // A query-text filter forces the query-level path; "o" matches every query.
      const fromFacts = await listPages(filters("q=o"), COMPARED);
      expect(fromFacts.rows.map((row) => [row.path, row.clicks, row.clicks_prev])).toEqual(
        fromRollup.rows.map((row) => [row.path, row.clicks, row.clicks_prev]),
      );
    });

    it("drills from a query to its pages", async () => {
      const { listPages } = await import("./seo");
      const result = await listPages(filters("query=tent+footprint"), COMPARED);
      expect(result.rows.map((row) => row.path)).toEqual(["/guides/tents/"]);
      expect(result.rows[0]?.clicks).toBe(2);
    });

    it("totals the daily trend for both periods", async () => {
      const { getSearchTrend } = await import("./seo");
      const trend = await getSearchTrend(filters(), COMPARED, "query");
      expect(trend.series).toHaveLength(7);
      expect(trend.previousSeries).toHaveLength(7);
      expect(trend.totals).toMatchObject({ clicks: 97, impressions: 1100 });
      expect(trend.totals.position).toBeCloseTo(9800 / 1100);
      expect(trend.previousTotals).toMatchObject({ clicks: 92, impressions: 540 });
      expect(trend.series.at(-1)).toMatchObject({ date: "2026-06-28", clicks: 92 });
      expect(trend.series[0]).toMatchObject({
        date: "2026-06-22",
        clicks: 0,
        ctr: null,
        position: null,
      });
    });

    it("restricts the trend to the entities that pass aggregate filters", async () => {
      const { getSearchTrend } = await import("./seo");
      const queries = await getSearchTrend(
        filters("min_clicks=10&brand=non_brand"),
        COMPARED,
        "query",
      );
      // "best hiking boots" (30) and "how to choose a tent" (15) pass; "tent footprint" (2) does not.
      expect(queries.totals.clicks).toBe(45);
      expect(queries.previousTotals?.clicks).toBe(44);
      const pages = await getSearchTrend(filters("position=1-3"), COMPARED, "page");
      // Pages averaging position 1-3 this period: "/" (1.0) and "/blog/boots/" (3.0).
      expect(pages.totals.clicks).toBe(80);
    });
  });

  describe("overview and AI visibility", () => {
    it("computes KPIs from the rollups", async () => {
      const { getOverview } = await import("./overview");
      const overview = await getOverview(COMPARED);
      expect(overview.kpis.sessions).toEqual({ value: 150, previous: 80 });
      expect(overview.kpis.conversions).toEqual({ value: 3, previous: 1 });
      expect(overview.kpis.clicks).toEqual({ value: 97, previous: 92 });
      expect(overview.kpis.ctr.value).toBeCloseTo(97 / 1100);
      expect(overview.kpis.position.value).toBeCloseTo(9800 / 1100);
      expect(overview.kpis.ai_visibility_score).toEqual({ value: 37.5, previous: null });
      expect(overview.series).toHaveLength(7);
      expect(overview.series.at(-1)?.sessions).toBe(150);
    });

    it("splits sessions by channel with shares", async () => {
      const { getChannelMix } = await import("./overview");
      const channels = await getChannelMix(COMPARED);
      expect(channels.map((row) => [row.channel, row.sessions, row.sessions_prev])).toEqual([
        ["Organic Search", 100, 80],
        ["Direct", 50, 0],
      ]);
      expect(channels[0]?.share).toBeCloseTo(2 / 3);
    });

    it("scores visibility and computes share of voice", async () => {
      const { getAiSummary } = await import("./ai-visibility");
      const summary = await getAiSummary({ engine: [] }, { current: CURRENT, previous: null });
      // (0.7 + 0.3) + 0.5 + 0 + 0 points over 4 answers.
      expect(summary.score).toBeCloseTo(37.5);
      expect(summary.mention_rate).toBeCloseTo(0.5);
      expect(summary.citation_rate).toBeCloseTo(0.25);
      expect(summary.share_of_voice.map((row) => [row.name, row.mentions, row.is_brand])).toEqual([
        ["Summit & Co", 3, false],
        ["Northpeak Outfitters", 2, true],
        ["TrailForge", 1, false],
      ]);
      expect(summary.share_of_voice[1]?.share).toBeCloseTo(2 / 6);
      expect(summary.share_of_voice[1]?.answer_rate).toBeCloseTo(0.5);
      const claude = await getAiSummary(
        { engine: ["claude"] },
        { current: CURRENT, previous: null },
      );
      expect(claude.score).toBeCloseTo(25);
      expect(claude.by_engine.map((row) => row.engine)).toEqual(["claude"]);
    });

    it("lists prompts with per-engine status and competitor counts", async () => {
      const { listPrompts, getPromptDetail } = await import("./ai-visibility");
      const prompts = await listPrompts({ engine: [] }, CURRENT);
      expect(prompts).toHaveLength(2);
      const bags = prompts.find((row) => row.topic === "Sleeping bags")!;
      expect(bags).toMatchObject({
        checks: 2,
        brand_mentions: 0,
        competitor_mentions: 2,
        mention_rate: 0,
      });
      expect(bags.competitors).toEqual({ "Summit & Co": 2, TrailForge: 1 });
      const tents = prompts.find((row) => row.topic === "Tents")!;
      expect(tents.engines.chatgpt).toMatchObject({
        latest_mentioned: true,
        latest_rank: 1,
        latest_cited: true,
      });
      const detail = await getPromptDetail(tents.prompt_id, { engine: [] }, CURRENT);
      expect(detail?.answers.map((answer) => answer.engine)).toEqual(["chatgpt", "claude"]);
      expect(await getPromptDetail(999, { engine: [] }, CURRENT)).toBeNull();
    });
  });

  describe("tasks", () => {
    it("deduplicates on dedupe_key and orders new tasks at the end of their column", async () => {
      const { createTask, listTasks } = await import("./tasks");
      const base: Pick<TaskCreate, "status" | "priority" | "labels" | "source"> = {
        status: "todo",
        priority: "medium",
        labels: [],
        source: "audit",
      };
      const first = await createTask({
        ...base,
        title: "A",
        dedupe_key: "audit:title_missing:/a/",
      });
      const again = await createTask({
        ...base,
        title: "A (again)",
        dedupe_key: "audit:title_missing:/a/",
      });
      expect(first.deduplicated).toBe(false);
      expect(again.deduplicated).toBe(true);
      expect(again.record.id).toBe(first.record.id);
      expect(again.record.title).toBe("A");

      await createTask({ ...base, title: "B", source: "manual" });
      await createTask({ ...base, title: "C", source: "manual" });
      const { rows, total } = await listTasks({ status: "todo", page: 1, page_size: 50 });
      expect(total).toBe(3);
      expect(rows.map((task) => task.title)).toEqual(["A", "B", "C"]);
      expect(rows.map((task) => task.sort_order)).toEqual([1000, 2000, 3000]);
    });

    it("moves a card between two neighbours and across columns", async () => {
      const { listTasks, moveTask } = await import("./tasks");
      const todo = async () => (await listTasks({ status: "todo", page: 1, page_size: 50 })).rows;
      const [a, b, c] = await todo();
      await moveTask({ id: c!.id, status: "todo", before_id: a!.id, after_id: b!.id });
      expect((await todo()).map((task) => task.title)).toEqual(["A", "C", "B"]);
      await moveTask({ id: b!.id, status: "todo", before_id: null, after_id: a!.id });
      expect((await todo()).map((task) => task.title)).toEqual(["B", "A", "C"]);

      const done = await moveTask({ id: a!.id, status: "done", before_id: null, after_id: null });
      expect(done.status).toBe("done");
      expect(done.completed_at).not.toBeNull();
      expect((await todo()).map((task) => task.title)).toEqual(["B", "C"]);
      const back = await moveTask({ id: a!.id, status: "todo", before_id: null, after_id: null });
      expect(back.completed_at).toBeNull();
      expect((await todo()).map((task) => task.title)).toEqual(["B", "C", "A"]);
    });

    it("flags overdue tasks and filters by label and due date", async () => {
      const { createTask, listTasks, updateTask, deleteTask, getTask } = await import("./tasks");
      const { record } = await createTask({
        title: "Overdue",
        status: "in_progress",
        priority: "high",
        labels: ["seo", "urgent-fix"],
        source: "manual",
        due_date: "2020-01-01",
        assignee_id: 1,
      });
      expect(record.overdue).toBe(true);
      expect(record.assignee).toEqual({ id: 1, name: "Maya Okafor", color: "#3b6fb6" });
      expect(
        (await listTasks({ due: "overdue", page: 1, page_size: 50 })).rows.map((t) => t.id),
      ).toEqual([record.id]);
      expect((await listTasks({ label: "urgent-fix", page: 1, page_size: 50 })).total).toBe(1);

      const finished = await updateTask(record.id, { status: "done" });
      expect(finished.overdue).toBe(false);
      expect(finished.completed_at).not.toBeNull();
      await deleteTask(record.id);
      await expect(getTask(record.id)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("plans, audits and saved views", () => {
    it("runs the brief workflow on a plan", async () => {
      const { createPlan, deletePlan, getPlan, listPlans, putBrief, updatePlan } =
        await import("./plans");
      const { record: plan } = await createPlan({
        title: "Tent Buying Guide",
        target_keyword: "how to choose a tent",
        intent: "informational",
        page_type: "guide",
        status: "idea",
        priority: "high",
        source: "manual",
        page_id: 1,
        owner_id: 1,
      });
      expect(plan).toMatchObject({ brief_status: "none", brief: null, task_count: 0 });
      expect(plan.page).toEqual({ id: 1, path: "/guides/tents/", title: "Tent Guide" });

      expect((await updatePlan(plan.id, { brief_status: "requested" })).brief_status).toBe(
        "requested",
      );
      expect(
        (await listPlans({ brief_status: "requested", page: 1, page_size: 50 })).rows.map(
          (p) => p.id,
        ),
      ).toEqual([plan.id]);

      const ready = await putBrief(plan.id, {
        status: "ready",
        generated_by: "heuristic",
        brief: {
          primary_keyword: "how to choose a tent",
          secondary_keywords: [],
          working_titles: ["How to Choose a Tent"],
          search_intent: "informational",
          intent_summary: "Searchers want criteria they can act on.",
          outline: [
            { heading: "Capacity", subheadings: [] },
            { heading: "Weight", subheadings: [] },
            { heading: "Weather", subheadings: [] },
          ],
          questions: [],
          entities: [],
          internal_links: [],
          meta_description: "Learn how to choose a tent by capacity, weight and weather.",
          target_word_count: 1800,
          current_ranking: {},
        },
      });
      expect(ready.brief_status).toBe("ready");
      expect(ready.brief?.generated_by).toBe("heuristic");
      expect(ready.brief?.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(ready.brief_updated_at).not.toBeNull();

      expect((await putBrief(plan.id, { status: "failed" })).brief_status).toBe("failed");
      await deletePlan(plan.id);
      await expect(getPlan(plan.id)).rejects.toBeInstanceOf(ApiError);
    });

    it("deduplicates plans created by automation", async () => {
      const { createPlan } = await import("./plans");
      const input = {
        title: "Answer page",
        intent: "informational",
        page_type: "guide",
        status: "idea",
        priority: "medium",
        source: "opportunity",
        dedupe_key: "opportunity:ai-gap:2",
      } as const;
      const first = await createPlan(input);
      const second = await createPlan({ ...input, title: "Different title" });
      expect([first.deduplicated, second.deduplicated]).toEqual([false, true]);
      expect(second.record.id).toBe(first.record.id);
    });

    it("ingests audits, links pages, and carries ignored issues forward", async () => {
      const { getAuditOverview, ingestAudit, listIssues, updateIssueStatus } =
        await import("./audits");
      const run = {
        site_url: SITE,
        started_at: "2026-06-28T06:00:00Z",
        finished_at: "2026-06-28T06:00:40Z",
        pages_crawled: 3,
        health_score: 90,
        summary: "Two issues.",
        summary_source: "heuristic" as const,
        issues: [
          {
            url: `${SITE}/blog/boots/`,
            rule: "title_missing",
            severity: "high" as const,
            message: "No title.",
            details: {},
          },
          {
            url: `${SITE}/gone/`,
            rule: "sitemap_url_error",
            severity: "high" as const,
            message: "404.",
            details: { status: 404 },
          },
        ],
        pages: [
          {
            url: `${SITE}/blog/boots/`,
            status_code: 200,
            word_count: 850,
            title: "Ignored: page already has one",
          },
        ],
      };
      const first = await ingestAudit(run);
      expect(first.run).toMatchObject({ pages_crawled: 3, issues_total: 2, health_score: 90 });
      expect(first.issues.map((issue) => [issue.rule, issue.page_id, issue.status])).toEqual([
        ["sitemap_url_error", null, "open"],
        ["title_missing", 2, "open"],
      ]);
      const [page] = await db.execute<{ word_count: number; status_code: number; title: string }>(
        sql`SELECT word_count, status_code, title FROM pages WHERE id = 2`,
      );
      expect(page).toEqual({ word_count: 850, status_code: 200, title: "Best Boots" });

      await updateIssueStatus(first.issues[0]!.id, "ignored");
      const { createTask } = await import("./tasks");
      const { record: task } = await createTask({
        title: "Add a title to the boots article",
        status: "todo",
        priority: "high",
        labels: [],
        source: "audit",
        dedupe_key: `audit:title_missing:${SITE}/blog/boots/`,
        audit_issue_id: first.issues[1]!.id,
      });
      const second = await ingestAudit({
        ...run,
        finished_at: "2026-06-29T06:00:40Z",
        started_at: "2026-06-29T06:00:00Z",
        health_score: 92,
      });
      expect(second.issues.map((issue) => [issue.rule, issue.status])).toEqual([
        ["sitemap_url_error", "ignored"],
        ["title_missing", "open"],
      ]);

      const overview = await getAuditOverview();
      expect(overview.run?.id).toBe(second.run.id);
      expect(overview.previous?.id).toBe(first.run.id);
      expect(overview.counts.open).toBe(1);
      expect(overview.counts.by_severity).toEqual({ critical: 0, high: 1, medium: 0, low: 0 });
      const listed = await listIssues({ status: "ignored", page: 1, page_size: 50 });
      expect(listed.run_id).toBe(second.run.id);
      expect(listed.rows.map((issue) => issue.path)).toEqual(["/gone/"]);
      expect(listed.rows.map((issue) => issue.task_id)).toEqual([null]);

      // The task opened for the first run's issue also covers the same issue in the next run.
      const open = await listIssues({ status: "open", page: 1, page_size: 50 });
      expect(open.rows.map((issue) => [issue.rule, issue.task_id])).toEqual([
        ["title_missing", task.id],
      ]);
    });

    it("stores saved views and rejects duplicate names as a conflict", async () => {
      const { createView, deleteView, listViews } = await import("./views");
      const view = await createView({
        name: "Non-brand",
        report: "seo",
        filters: { brand: "non_brand" },
      });
      expect(await listViews("seo")).toEqual([view]);
      const duplicate = await createView({ name: "Non-brand", report: "seo", filters: {} }).catch(
        fromDatabaseError,
      );
      expect(duplicate).toBeInstanceOf(ApiError);
      expect((duplicate as ApiError).status).toBe(409);
      await deleteView(view.id);
      expect(await listViews("seo")).toEqual([]);
      await expect(deleteView(view.id)).rejects.toMatchObject({ status: 404 });
    });
  });
});
