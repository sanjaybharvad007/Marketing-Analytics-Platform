/** Request and resource schemas shared by the REST API and the server actions. */
import { z } from "zod";
import {
  BRIEF_STATUSES,
  INTENTS,
  ISSUE_STATUSES,
  PAGE_TYPES,
  PLAN_SOURCES,
  PLAN_STATUSES,
  PRIORITIES,
  REPORTS,
  SEVERITIES,
  TASK_SOURCES,
  TASK_STATUSES,
} from "@/lib/domain";
import { isoDate } from "@/lib/filters/params";

const id = z.number().int().positive();
const optionalId = id.nullable().optional();
/** Required text. The messages are shown as-is next to form fields. */
const trimmed = (max: number) =>
  z.string().trim().min(1, "This field is required.").max(max, `Use at most ${max} characters.`);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

// --- content briefs -----------------------------------------------------------

export const contentBriefSchema = z.object({
  primary_keyword: trimmed(200),
  secondary_keywords: z.array(trimmed(200)).max(12).default([]),
  working_titles: z.array(trimmed(200)).min(1).max(5),
  search_intent: z.enum(INTENTS),
  intent_summary: trimmed(600),
  outline: z
    .array(
      z.object({
        heading: trimmed(160),
        subheadings: z.array(trimmed(160)).max(8).default([]),
      }),
    )
    .min(3)
    .max(12),
  questions: z.array(trimmed(300)).max(10).default([]),
  entities: z.array(trimmed(80)).max(20).default([]),
  internal_links: z
    .array(z.object({ url: trimmed(500), title: trimmed(300), reason: z.string().max(240) }))
    .max(6)
    .default([]),
  meta_description: z.string().trim().min(20).max(170),
  target_word_count: z.number().int().min(200).max(6000),
  current_ranking: z
    .object({
      position: z.number().nullable().optional(),
      url: z.string().nullable().optional(),
      search_volume: z.number().nullable().optional(),
    })
    .default({}),
  generated_by: z.enum(["llm", "heuristic"]).optional(),
  generated_at: z.string().optional(),
});
export type ContentBrief = z.output<typeof contentBriefSchema>;

export const briefPutSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    brief: contentBriefSchema,
    generated_by: z.enum(["llm", "heuristic"]).default("heuristic"),
  }),
  z.object({ status: z.literal("failed"), error: z.string().trim().max(1000).optional() }),
]);
export type BriefPut = z.output<typeof briefPutSchema>;

// --- plans --------------------------------------------------------------------

const planFields = {
  title: trimmed(200),
  target_keyword: optionalText(200),
  intent: z.enum(INTENTS),
  page_type: z.enum(PAGE_TYPES),
  status: z.enum(PLAN_STATUSES),
  priority: z.enum(PRIORITIES),
  owner_id: optionalId,
  target_url: optionalText(500),
  page_id: optionalId,
  est_monthly_traffic: z.number().int().min(0).max(100_000_000).nullable().optional(),
  due_date: isoDate.nullable().optional(),
  notes: optionalText(5000),
};

export const planCreateSchema = z.object({
  ...planFields,
  intent: planFields.intent.default("informational"),
  page_type: planFields.page_type.default("article"),
  status: planFields.status.default("idea"),
  priority: planFields.priority.default("medium"),
  source: z.enum(PLAN_SOURCES).default("manual"),
  dedupe_key: trimmed(300).optional(),
});
export type PlanCreate = z.output<typeof planCreateSchema>;

export const planPatchSchema = z
  .object({
    ...planFields,
    // Only these two transitions are open to clients; "ready" and "failed"
    // are set by writing the brief itself.
    brief_status: z.enum(["none", "requested"]),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");
export type PlanPatch = z.output<typeof planPatchSchema>;

export const planListSchema = z.object({
  status: z.enum(PLAN_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  page_type: z.enum(PAGE_TYPES).optional(),
  owner_id: z.coerce.number().int().positive().optional(),
  brief_status: z.enum(BRIEF_STATUSES).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});
export type PlanListQuery = z.output<typeof planListSchema>;

// --- tasks --------------------------------------------------------------------

const label = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9 _-]{0,39}$/,
    "Labels use letters, digits, spaces, hyphens or underscores",
  );

const taskFields = {
  title: trimmed(200),
  description: optionalText(5000),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(PRIORITIES),
  assignee_id: optionalId,
  due_date: isoDate.nullable().optional(),
  labels: z
    .array(label)
    .max(10)
    .transform((labels) => [...new Set(labels)]),
  plan_id: optionalId,
  page_id: optionalId,
  audit_issue_id: optionalId,
};

export const taskCreateSchema = z.object({
  ...taskFields,
  status: taskFields.status.default("backlog"),
  priority: taskFields.priority.default("medium"),
  labels: taskFields.labels.default([]),
  source: z.enum(TASK_SOURCES).default("manual"),
  dedupe_key: trimmed(300).optional(),
  evidence: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type TaskCreate = z.output<typeof taskCreateSchema>;

export const taskPatchSchema = z
  .object({ ...taskFields, sort_order: z.number().finite() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");
export type TaskPatch = z.output<typeof taskPatchSchema>;

export const taskListSchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignee_id: z.coerce.number().int().positive().optional(),
  label: z.string().trim().toLowerCase().min(1).max(40).optional(),
  source: z.enum(TASK_SOURCES).optional(),
  due: z.enum(["overdue", "week", "none"]).optional(),
  plan_id: z.coerce.number().int().positive().optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(500).default(200),
});
export type TaskListQuery = z.output<typeof taskListSchema>;

export const taskMoveSchema = z.object({
  id,
  status: z.enum(TASK_STATUSES),
  // The tasks that should sit directly above and below after the move.
  before_id: id.nullable(),
  after_id: id.nullable(),
});
export type TaskMove = z.output<typeof taskMoveSchema>;

// --- audits -------------------------------------------------------------------

export const auditIngestSchema = z
  .object({
    site_url: z.url().max(500),
    started_at: z.iso.datetime({ offset: true }),
    finished_at: z.iso.datetime({ offset: true }),
    pages_crawled: z.number().int().min(0),
    health_score: z.number().min(0).max(100),
    summary: z.string().max(10_000).nullable().optional(),
    summary_source: z.enum(["heuristic", "llm"]).default("heuristic"),
    issues: z
      .array(
        z.object({
          url: z.url().max(2000),
          rule: z.string().regex(/^[a-z][a-z0-9_]{1,59}$/),
          severity: z.enum(SEVERITIES),
          message: trimmed(1000),
          details: z.record(z.string(), z.unknown()).default({}),
        }),
      )
      .max(10_000),
    pages: z
      .array(
        z.object({
          url: z.url().max(2000),
          status_code: z.number().int().min(100).max(599).nullable().optional(),
          word_count: z.number().int().min(0).nullable().optional(),
          title: z.string().max(1000).nullable().optional(),
        }),
      )
      .max(10_000)
      .default([]),
  })
  .refine((value) => Date.parse(value.finished_at) >= Date.parse(value.started_at), {
    message: "finished_at is before started_at",
    path: ["finished_at"],
  });
export type AuditIngest = z.output<typeof auditIngestSchema>;

export const issuePatchSchema = z.object({ status: z.enum(ISSUE_STATUSES) });

export const issueListSchema = z.object({
  run_id: z.coerce.number().int().positive().optional(),
  severity: z.enum(SEVERITIES).optional(),
  rule: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .max(60)
    .optional(),
  status: z.enum(ISSUE_STATUSES).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});
export type IssueListQuery = z.output<typeof issueListSchema>;

// --- saved views, pipeline runs -------------------------------------------------

const filterValue = z.union([
  z.string().max(500),
  z.number(),
  z.boolean(),
  z.array(z.string().max(100)).max(50),
]);

export const viewCreateSchema = z.object({
  name: trimmed(80),
  report: z.enum(REPORTS),
  filters: z.record(z.string().max(40), filterValue),
});
export type ViewCreate = z.output<typeof viewCreateSchema>;

export const viewListSchema = z.object({ report: z.enum(REPORTS).optional() });

export const runListSchema = z.object({
  pipeline: z.enum(["ga4", "gsc", "seo", "ai_visibility"]).optional(),
  status: z.enum(["running", "success", "failed"]).optional(),
  mode: z.enum(["demo", "live"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});
export type RunListQuery = z.output<typeof runListSchema>;
