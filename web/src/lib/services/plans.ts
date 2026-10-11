/** Content plans: the page-planning records behind /planner and /api/v1/plans. */
import { eq, type SQL, sql } from "drizzle-orm";
import { db, type Executor, queryRows } from "@/db/client";
import { contentPlans } from "@/db/schema";
import { notFound } from "@/lib/api/errors";
import type {
  BriefPut,
  ContentBrief,
  PlanCreate,
  PlanListQuery,
  PlanPatch,
} from "@/lib/api/schemas";
import type { DateRange } from "@/lib/dates";
import type { BriefStatus, Intent, PageType, PlanSource, PlanStatus, Priority } from "@/lib/domain";
import { containsPattern } from "@/lib/filters/params";
import { andAll, inList } from "@/lib/filters/sql";
import type { MemberRef } from "./members";
import { isoTimestamp, limitOffset, type Listed, splitTotal } from "./sql-helpers";

export interface Plan {
  id: number;
  title: string;
  target_keyword: string | null;
  intent: Intent;
  page_type: PageType;
  status: PlanStatus;
  priority: Priority;
  owner_id: number | null;
  owner: MemberRef | null;
  target_url: string | null;
  page_id: number | null;
  page: { id: number; path: string; title: string | null } | null;
  est_monthly_traffic: number | null;
  due_date: string | null;
  brief: ContentBrief | null;
  brief_status: BriefStatus;
  brief_updated_at: string | null;
  notes: string | null;
  source: PlanSource;
  task_count: number;
  created_at: string;
  updated_at: string;
}

const PLAN_COLUMNS = sql`
  c.id, c.title, c.target_keyword, c.intent, c.page_type, c.status, c.priority,
  c.owner_id,
  CASE WHEN m.id IS NULL THEN NULL
       ELSE jsonb_build_object('id', m.id, 'name', m.name, 'color', m.color) END AS owner,
  c.target_url, c.page_id,
  CASE WHEN p.id IS NULL THEN NULL
       ELSE jsonb_build_object('id', p.id, 'path', p.path, 'title', p.title) END AS page,
  c.est_monthly_traffic, c.due_date::text AS due_date, c.brief, c.brief_status,
  ${isoTimestamp(sql`c.brief_updated_at`)} AS brief_updated_at,
  c.notes, c.source,
  (SELECT count(*)::int FROM tasks t WHERE t.plan_id = c.id) AS task_count,
  ${isoTimestamp(sql`c.created_at`)} AS created_at,
  ${isoTimestamp(sql`c.updated_at`)} AS updated_at`;

const PLAN_FROM = sql`
  FROM content_plans c
  LEFT JOIN members m ON m.id = c.owner_id
  LEFT JOIN pages p ON p.id = c.page_id`;

const STATUS_ORDER = sql`array_position(
  ARRAY['idea', 'brief', 'draft', 'review', 'scheduled', 'published'], c.status)`;
const PRIORITY_ORDER = sql`array_position(ARRAY['urgent', 'high', 'medium', 'low'], c.priority)`;

export async function listPlans(query: PlanListQuery): Promise<Listed<Plan>> {
  const conditions: SQL[] = [];
  if (query.status) conditions.push(sql`c.status = ${query.status}`);
  if (query.priority) conditions.push(sql`c.priority = ${query.priority}`);
  if (query.page_type) conditions.push(sql`c.page_type = ${query.page_type}`);
  if (query.owner_id) conditions.push(sql`c.owner_id = ${query.owner_id}`);
  if (query.brief_status) conditions.push(sql`c.brief_status = ${query.brief_status}`);
  if (query.q) {
    const pattern = containsPattern(query.q);
    conditions.push(sql`(c.title ILIKE ${pattern} OR c.target_keyword ILIKE ${pattern})`);
  }
  const rows = await queryRows<Plan & { total: number }>(sql`
    SELECT ${PLAN_COLUMNS}, (count(*) OVER ())::int AS total
    ${PLAN_FROM}
    WHERE ${andAll(conditions)}
    ORDER BY ${STATUS_ORDER}, ${PRIORITY_ORDER}, c.due_date NULLS LAST, c.id
    ${limitOffset(query.page, query.page_size)}
  `);
  return splitTotal(rows);
}

export async function findPlan(id: number, executor: Executor = db): Promise<Plan | null> {
  const [row] = await queryRows<Plan>(
    sql`SELECT ${PLAN_COLUMNS} ${PLAN_FROM} WHERE c.id = ${id}`,
    executor,
  );
  return row ?? null;
}

export async function getPlan(id: number): Promise<Plan> {
  const plan = await findPlan(id);
  if (!plan) throw notFound("Plan");
  return plan;
}

export interface Upserted<T> {
  record: T;
  /** True when an existing record with the same dedupe key was returned instead. */
  deduplicated: boolean;
}

export async function createPlan(input: PlanCreate): Promise<Upserted<Plan>> {
  const values = {
    title: input.title,
    targetKeyword: input.target_keyword ?? null,
    intent: input.intent,
    pageType: input.page_type,
    status: input.status,
    priority: input.priority,
    ownerId: input.owner_id ?? null,
    targetUrl: input.target_url ?? null,
    pageId: input.page_id ?? null,
    estMonthlyTraffic: input.est_monthly_traffic ?? null,
    dueDate: input.due_date ?? null,
    notes: input.notes ?? null,
    source: input.source,
    dedupeKey: input.dedupe_key ?? null,
  };
  const [inserted] = await db
    .insert(contentPlans)
    .values(values)
    .onConflictDoNothing({ target: contentPlans.dedupeKey })
    .returning({ id: contentPlans.id });
  if (inserted) return { record: await getPlan(inserted.id), deduplicated: false };

  // The dedupe key already exists: hand back the plan that owns it.
  const [existing] = await db
    .select({ id: contentPlans.id })
    .from(contentPlans)
    .where(eq(contentPlans.dedupeKey, values.dedupeKey ?? ""));
  if (!existing) throw notFound("Plan");
  return { record: await getPlan(existing.id), deduplicated: true };
}

export async function updatePlan(id: number, patch: PlanPatch): Promise<Plan> {
  const changes: Partial<typeof contentPlans.$inferInsert> = {};
  if (patch.title !== undefined) changes.title = patch.title;
  if (patch.target_keyword !== undefined) changes.targetKeyword = patch.target_keyword;
  if (patch.intent !== undefined) changes.intent = patch.intent;
  if (patch.page_type !== undefined) changes.pageType = patch.page_type;
  if (patch.status !== undefined) changes.status = patch.status;
  if (patch.priority !== undefined) changes.priority = patch.priority;
  if (patch.owner_id !== undefined) changes.ownerId = patch.owner_id;
  if (patch.target_url !== undefined) changes.targetUrl = patch.target_url;
  if (patch.page_id !== undefined) changes.pageId = patch.page_id;
  if (patch.est_monthly_traffic !== undefined) {
    changes.estMonthlyTraffic = patch.est_monthly_traffic;
  }
  if (patch.due_date !== undefined) changes.dueDate = patch.due_date;
  if (patch.notes !== undefined) changes.notes = patch.notes;
  if (patch.brief_status !== undefined) changes.briefStatus = patch.brief_status;

  const [updated] = await db
    .update(contentPlans)
    .set(changes)
    .where(eq(contentPlans.id, id))
    .returning({ id: contentPlans.id });
  if (!updated) throw notFound("Plan");
  return getPlan(id);
}

export async function deletePlan(id: number): Promise<void> {
  const deleted = await db
    .delete(contentPlans)
    .where(eq(contentPlans.id, id))
    .returning({ id: contentPlans.id });
  if (deleted.length === 0) throw notFound("Plan");
}

/** Store a finished brief, or record that generating it failed. */
export async function putBrief(id: number, body: BriefPut): Promise<Plan> {
  const now = new Date();
  const changes: Partial<typeof contentPlans.$inferInsert> =
    body.status === "ready"
      ? {
          brief: {
            ...body.brief,
            generated_by: body.generated_by,
            generated_at: now.toISOString(),
          },
          briefStatus: "ready",
          briefUpdatedAt: now,
        }
      : { briefStatus: "failed", briefUpdatedAt: now };
  const [updated] = await db
    .update(contentPlans)
    .set(changes)
    .where(eq(contentPlans.id, id))
    .returning({ id: contentPlans.id });
  if (!updated) throw notFound("Plan");
  return getPlan(id);
}

export interface PageSearchMetrics {
  page_id: number;
  clicks: number;
  impressions: number;
  position: number | null;
}

/** Organic search totals for the given pages, for "current metrics" on linked plans. */
export async function getPageSearchMetrics(
  pageIds: number[],
  range: DateRange,
): Promise<Map<number, PageSearchMetrics>> {
  if (pageIds.length === 0) return new Map();
  const rows = await queryRows<PageSearchMetrics>(sql`
    SELECT s.page_id, sum(s.clicks)::float8 AS clicks, sum(s.impressions)::float8 AS impressions,
           (sum(s.sum_position) / NULLIF(sum(s.impressions), 0))::float8 AS position
    FROM mv_search_page_daily s
    WHERE s.date BETWEEN ${range.from} AND ${range.to} AND ${inList(sql`s.page_id`, pageIds)}
    GROUP BY s.page_id
  `);
  return new Map(rows.map((row) => [row.page_id, row]));
}
