/**
 * Typed mirror of the tables created by db/migrations/*.sql.
 *
 * The SQL migrations are the source of truth; this file never creates or
 * alters anything. `schema-drift.test.ts` compares it with the live database
 * and fails when the two disagree.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  date,
  doublePrecision,
  integer,
  jsonb,
  numeric,
  pgMaterializedView,
  pgTable,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type {
  BriefStatus,
  Device,
  Engine,
  Intent,
  IssueStatus,
  PageType,
  PipelineName,
  PlanSource,
  PlanStatus,
  Priority,
  Report,
  RunStatus,
  Sentiment,
  Severity,
  TaskSource,
  TaskStatus,
} from "@/lib/domain";
import type { ContentBrief } from "@/lib/api/schemas";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const day = (name: string) => date(name, { mode: "string" });
const id = () => integer("id").primaryKey().generatedAlwaysAsIdentity();

export const pages = pgTable("pages", {
  id: id(),
  url: text("url").notNull(),
  path: text("path").notNull(),
  title: text("title"),
  section: text("section").notNull(),
  pageType: text("page_type").$type<PageType>().notNull(),
  statusCode: integer("status_code"),
  wordCount: integer("word_count"),
  publishedAt: timestamptz("published_at"),
  firstSeenAt: timestamptz("first_seen_at").notNull().defaultNow(),
  lastSeenAt: timestamptz("last_seen_at").notNull().defaultNow(),
});

export const members = pgTable("members", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  color: text("color").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const pipelineRuns = pgTable("pipeline_runs", {
  id: id(),
  pipeline: text("pipeline").$type<PipelineName>().notNull(),
  mode: text("mode").$type<"demo" | "live">().notNull(),
  status: text("status").$type<RunStatus>().notNull(),
  startedAt: timestamptz("started_at").notNull().defaultNow(),
  finishedAt: timestamptz("finished_at"),
  rowsLoaded: integer("rows_loaded").notNull().default(0),
  windowStart: day("window_start").notNull(),
  windowEnd: day("window_end").notNull(),
  error: text("error"),
});

export const gaDaily = pgTable("ga_daily", {
  date: day("date").notNull(),
  pageId: integer("page_id").notNull(),
  channel: text("channel").notNull(),
  device: text("device").$type<Device>().notNull(),
  country: char("country", { length: 2 }).notNull(),
  sessions: integer("sessions").notNull(),
  users: integer("users").notNull(),
  engagedSessions: integer("engaged_sessions").notNull(),
  conversions: integer("conversions").notNull(),
  revenue: numeric("revenue", { precision: 12, scale: 2 }).notNull(),
  loadedAt: timestamptz("loaded_at").notNull().defaultNow(),
});

export const gscDaily = pgTable("gsc_daily", {
  date: day("date").notNull(),
  pageId: integer("page_id").notNull(),
  query: text("query").notNull(),
  country: char("country", { length: 2 }).notNull(),
  device: text("device").$type<Device>().notNull(),
  clicks: integer("clicks").notNull(),
  impressions: integer("impressions").notNull(),
  sumPosition: doublePrecision("sum_position").notNull(),
  isBrand: boolean("is_brand").notNull().default(false),
  loadedAt: timestamptz("loaded_at").notNull().defaultNow(),
});

export const keywords = pgTable("keywords", {
  id: id(),
  keyword: text("keyword").notNull(),
  searchVolume: integer("search_volume").notNull().default(0),
  difficulty: smallint("difficulty"),
  intent: text("intent").$type<Intent>().notNull(),
  cpc: numeric("cpc", { precision: 8, scale: 2 }),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

export const keywordRankings = pgTable("keyword_rankings", {
  date: day("date").notNull(),
  keywordId: integer("keyword_id").notNull(),
  pageId: integer("page_id"),
  position: smallint("position"),
  serpFeatures: text("serp_features")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  loadedAt: timestamptz("loaded_at").notNull().defaultNow(),
});

export const domainMetricsDaily = pgTable("domain_metrics_daily", {
  date: day("date").notNull(),
  domain: text("domain").notNull(),
  isOwn: boolean("is_own").notNull().default(false),
  authorityScore: smallint("authority_score").notNull(),
  referringDomains: integer("referring_domains").notNull(),
  backlinks: integer("backlinks").notNull(),
  loadedAt: timestamptz("loaded_at").notNull().defaultNow(),
});

export const aiPrompts = pgTable("ai_prompts", {
  id: id(),
  prompt: text("prompt").notNull(),
  topic: text("topic").notNull(),
  intent: text("intent").$type<Intent>().notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const aiVisibilityResults = pgTable("ai_visibility_results", {
  date: day("date").notNull(),
  promptId: integer("prompt_id").notNull(),
  engine: text("engine").$type<Engine>().notNull(),
  brandMentioned: boolean("brand_mentioned").notNull(),
  brandRank: smallint("brand_rank"),
  cited: boolean("cited").notNull().default(false),
  citedUrl: text("cited_url"),
  sentiment: text("sentiment").$type<Sentiment>(),
  competitorsMentioned: text("competitors_mentioned")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  answerExcerpt: text("answer_excerpt").notNull().default(""),
  loadedAt: timestamptz("loaded_at").notNull().defaultNow(),
});

export const contentPlans = pgTable("content_plans", {
  id: id(),
  title: text("title").notNull(),
  targetKeyword: text("target_keyword"),
  intent: text("intent").$type<Intent>().notNull().default("informational"),
  pageType: text("page_type").$type<PageType>().notNull().default("article"),
  status: text("status").$type<PlanStatus>().notNull().default("idea"),
  priority: text("priority").$type<Priority>().notNull().default("medium"),
  ownerId: integer("owner_id"),
  targetUrl: text("target_url"),
  pageId: integer("page_id"),
  estMonthlyTraffic: integer("est_monthly_traffic"),
  dueDate: day("due_date"),
  brief: jsonb("brief").$type<ContentBrief>(),
  briefStatus: text("brief_status").$type<BriefStatus>().notNull().default("none"),
  briefUpdatedAt: timestamptz("brief_updated_at"),
  notes: text("notes"),
  source: text("source").$type<PlanSource>().notNull().default("manual"),
  dedupeKey: text("dedupe_key"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

export const auditRuns = pgTable("audit_runs", {
  id: id(),
  siteUrl: text("site_url").notNull(),
  startedAt: timestamptz("started_at").notNull(),
  finishedAt: timestamptz("finished_at").notNull(),
  pagesCrawled: integer("pages_crawled").notNull(),
  issuesTotal: integer("issues_total").notNull(),
  healthScore: numeric("health_score", { precision: 5, scale: 1 }).notNull(),
  summary: text("summary"),
  summarySource: text("summary_source").$type<"heuristic" | "llm">().notNull().default("heuristic"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const auditIssues = pgTable("audit_issues", {
  id: id(),
  runId: integer("run_id").notNull(),
  pageId: integer("page_id"),
  url: text("url").notNull(),
  rule: text("rule").notNull(),
  severity: text("severity").$type<Severity>().notNull(),
  message: text("message").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").$type<IssueStatus>().notNull().default("open"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: id(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").$type<TaskStatus>().notNull().default("backlog"),
  priority: text("priority").$type<Priority>().notNull().default("medium"),
  assigneeId: integer("assignee_id"),
  dueDate: day("due_date"),
  labels: text("labels")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  sortOrder: doublePrecision("sort_order").notNull().default(0),
  planId: integer("plan_id"),
  pageId: integer("page_id"),
  auditIssueId: integer("audit_issue_id"),
  source: text("source").$type<TaskSource>().notNull().default("manual"),
  dedupeKey: text("dedupe_key"),
  evidence: jsonb("evidence").$type<Record<string, unknown>>(),
  completedAt: timestamptz("completed_at"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

export const savedViews = pgTable("saved_views", {
  id: id(),
  name: text("name").notNull(),
  report: text("report").$type<Report>().notNull(),
  filters: jsonb("filters").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

// --- Rollups (materialized views refreshed by the pipelines) ----------------

export const mvTrafficDaily = pgMaterializedView("mv_traffic_daily", {
  date: day("date").notNull(),
  section: text("section").notNull(),
  channel: text("channel").notNull(),
  device: text("device").$type<Device>().notNull(),
  country: char("country", { length: 2 }).notNull(),
  sessions: integer("sessions").notNull(),
  users: integer("users").notNull(),
  engagedSessions: integer("engaged_sessions").notNull(),
  conversions: integer("conversions").notNull(),
  revenue: numeric("revenue", { precision: 14, scale: 2 }).notNull(),
}).existing();

export const mvSearchPageDaily = pgMaterializedView("mv_search_page_daily", {
  date: day("date").notNull(),
  pageId: integer("page_id").notNull(),
  country: char("country", { length: 2 }).notNull(),
  device: text("device").$type<Device>().notNull(),
  isBrand: boolean("is_brand").notNull(),
  clicks: integer("clicks").notNull(),
  impressions: integer("impressions").notNull(),
  sumPosition: doublePrecision("sum_position").notNull(),
}).existing();

export const mvAiVisibilityDaily = pgMaterializedView("mv_ai_visibility_daily", {
  date: day("date").notNull(),
  engine: text("engine").$type<Engine>().notNull(),
  topic: text("topic").notNull(),
  checks: integer("checks").notNull(),
  mentioned: integer("mentioned").notNull(),
  cited: integer("cited").notNull(),
  rank1: integer("rank_1").notNull(),
  rank2: integer("rank_2").notNull(),
  rank3: integer("rank_3").notNull(),
  rank4Plus: integer("rank_4_plus").notNull(),
  positive: integer("positive").notNull(),
  negative: integer("negative").notNull(),
}).existing();

export const TABLES = {
  pages,
  members,
  pipelineRuns,
  gaDaily,
  gscDaily,
  keywords,
  keywordRankings,
  domainMetricsDaily,
  aiPrompts,
  aiVisibilityResults,
  contentPlans,
  auditRuns,
  auditIssues,
  tasks,
  savedViews,
} as const;

export const ROLLUPS = { mvTrafficDaily, mvSearchPageDaily, mvAiVisibilityDaily } as const;
