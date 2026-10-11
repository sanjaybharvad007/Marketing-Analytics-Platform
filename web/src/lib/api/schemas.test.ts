import { describe, expect, it } from "vitest";
import {
  auditIngestSchema,
  briefPutSchema,
  planCreateSchema,
  planPatchSchema,
  taskCreateSchema,
  taskMoveSchema,
  taskPatchSchema,
  viewCreateSchema,
} from "./schemas";

const fields = (result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } }) =>
  result.error?.issues.map((issue) => issue.path.join(".")) ?? [];

describe("planCreateSchema", () => {
  it("fills defaults and trims text", () => {
    expect(planCreateSchema.parse({ title: "  Sleeping Bag Guide  ", notes: "   " })).toEqual({
      title: "Sleeping Bag Guide",
      intent: "informational",
      page_type: "article",
      status: "idea",
      priority: "medium",
      source: "manual",
      notes: null,
    });
  });

  it("rejects an empty title, bad enum values and bad dates", () => {
    const result = planCreateSchema.safeParse({
      title: " ",
      status: "doing",
      due_date: "2026-02-30",
      est_monthly_traffic: -5,
    });
    expect(fields(result).sort()).toEqual(["due_date", "est_monthly_traffic", "status", "title"]);
  });
});

describe("planPatchSchema", () => {
  it("accepts partial updates and clearing nullable fields", () => {
    expect(planPatchSchema.parse({ status: "draft", owner_id: null, due_date: null })).toEqual({
      status: "draft",
      owner_id: null,
      due_date: null,
    });
  });

  it("only lets clients request or clear a brief", () => {
    expect(planPatchSchema.safeParse({ brief_status: "requested" }).success).toBe(true);
    expect(planPatchSchema.safeParse({ brief_status: "ready" }).success).toBe(false);
  });

  it("rejects an empty patch", () => {
    expect(planPatchSchema.safeParse({}).success).toBe(false);
  });
});

describe("taskCreateSchema", () => {
  it("normalises labels: lower case, trimmed, unique", () => {
    const task = taskCreateSchema.parse({
      title: "Fix titles",
      labels: ["SEO", " seo ", "On-Page"],
    });
    expect(task.labels).toEqual(["seo", "on-page"]);
    expect(task).toMatchObject({ status: "backlog", priority: "medium", source: "manual" });
  });

  it("rejects labels with unsupported characters and too many labels", () => {
    expect(taskCreateSchema.safeParse({ title: "x", labels: ["<script>"] }).success).toBe(false);
    expect(
      taskCreateSchema.safeParse({
        title: "x",
        labels: Array.from({ length: 11 }, (_, i) => `l${i}`),
      }).success,
    ).toBe(false);
  });

  it("accepts automation fields", () => {
    const task = taskCreateSchema.parse({
      title: "Move query onto page one",
      source: "opportunity",
      dedupe_key: "opportunity:striking:tents",
      evidence: { position: 12.4, impressions: 4000 },
      page_id: 6,
    });
    expect(task.dedupe_key).toBe("opportunity:striking:tents");
    expect(task.evidence).toEqual({ position: 12.4, impressions: 4000 });
  });
});

describe("task patch and move", () => {
  it("accepts a sort order and rejects non-finite values", () => {
    expect(taskPatchSchema.parse({ sort_order: 1500.5 })).toEqual({ sort_order: 1500.5 });
    expect(taskPatchSchema.safeParse({ sort_order: Number.POSITIVE_INFINITY }).success).toBe(false);
  });

  it("requires both neighbour fields, either of which may be null", () => {
    expect(taskMoveSchema.parse({ id: 3, status: "done", before_id: null, after_id: 9 })).toEqual({
      id: 3,
      status: "done",
      before_id: null,
      after_id: 9,
    });
    expect(taskMoveSchema.safeParse({ id: 3, status: "done" }).success).toBe(false);
    expect(
      taskMoveSchema.safeParse({ id: 3, status: "archived", before_id: null, after_id: null })
        .success,
    ).toBe(false);
  });
});

describe("briefPutSchema", () => {
  const brief = {
    primary_keyword: "how to choose a sleeping bag",
    working_titles: ["How to Choose a Sleeping Bag"],
    search_intent: "informational",
    intent_summary: "Searchers want to understand ratings and fill types.",
    outline: [
      { heading: "Ratings" },
      { heading: "Fill", subheadings: ["Down", "Synthetic"] },
      { heading: "Fit" },
    ],
    meta_description: "Learn how to choose a sleeping bag by rating, fill and fit.",
    target_word_count: 1800,
  };

  it("accepts a complete brief and fills optional lists", () => {
    const parsed = briefPutSchema.parse({ status: "ready", brief });
    expect(parsed.status).toBe("ready");
    if (parsed.status === "ready") {
      expect(parsed.generated_by).toBe("heuristic");
      expect(parsed.brief.questions).toEqual([]);
      expect(parsed.brief.outline[0]?.subheadings).toEqual([]);
    }
  });

  it("rejects a brief with too short an outline or an over-long meta description", () => {
    const short = briefPutSchema.safeParse({
      status: "ready",
      brief: { ...brief, outline: brief.outline.slice(0, 2) },
    });
    const long = briefPutSchema.safeParse({
      status: "ready",
      brief: { ...brief, meta_description: "x".repeat(171) },
    });
    expect(fields(short)).toEqual(["brief.outline"]);
    expect(fields(long)).toEqual(["brief.meta_description"]);
  });

  it("accepts a failure report without a brief", () => {
    expect(briefPutSchema.parse({ status: "failed", error: "LLM timeout" })).toEqual({
      status: "failed",
      error: "LLM timeout",
    });
    expect(briefPutSchema.safeParse({ status: "requested" }).success).toBe(false);
  });
});

describe("auditIngestSchema", () => {
  const run = {
    site_url: "https://www.northpeak.example",
    started_at: "2026-06-01T06:00:00+00:00",
    finished_at: "2026-06-01T06:00:41+00:00",
    pages_crawled: 25,
    health_score: 89,
    issues: [
      {
        url: "https://www.northpeak.example/stores/boulder/",
        rule: "title_missing",
        severity: "high",
        message: "The page has no <title>.",
      },
    ],
  };

  it("accepts a run and defaults optional parts", () => {
    const parsed = auditIngestSchema.parse(run);
    expect(parsed.summary_source).toBe("heuristic");
    expect(parsed.pages).toEqual([]);
    expect(parsed.issues[0]?.details).toEqual({});
  });

  it("rejects malformed rules, severities and scores", () => {
    const result = auditIngestSchema.safeParse({
      ...run,
      health_score: 140,
      issues: [{ ...run.issues[0], rule: "Title Missing!", severity: "blocker" }],
    });
    expect(fields(result).sort()).toEqual(["health_score", "issues.0.rule", "issues.0.severity"]);
  });

  it("rejects a run that finishes before it starts, comparing instants not strings", () => {
    const reversed = auditIngestSchema.safeParse({
      ...run,
      finished_at: "2026-06-01T05:00:00+00:00",
    });
    expect(fields(reversed)).toEqual(["finished_at"]);
    // 08:00+02:00 is the same instant as 06:00Z, so this run has zero duration and is valid.
    const offsets = auditIngestSchema.safeParse({
      ...run,
      started_at: "2026-06-01T08:00:00+02:00",
      finished_at: "2026-06-01T06:00:00Z",
    });
    expect(offsets.success).toBe(true);
  });
});

describe("viewCreateSchema", () => {
  it("accepts string, number, boolean and string-list filter values", () => {
    const view = viewCreateSchema.parse({
      name: " Non-brand ",
      report: "seo",
      filters: { brand: "non_brand", min_impressions: 300, position: ["11-20"], compare: true },
    });
    expect(view.name).toBe("Non-brand");
  });

  it("rejects nested objects and unknown reports", () => {
    expect(
      viewCreateSchema.safeParse({ name: "x", report: "seo", filters: { a: { b: 1 } } }).success,
    ).toBe(false);
    expect(viewCreateSchema.safeParse({ name: "x", report: "ppc", filters: {} }).success).toBe(
      false,
    );
  });
});
