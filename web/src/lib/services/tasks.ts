/** Tasks: the work-management records behind /work and /api/v1/tasks. */
import { and, eq, type SQL, sql } from "drizzle-orm";
import { db, queryRows } from "@/db/client";
import { tasks } from "@/db/schema";
import { notFound } from "@/lib/api/errors";
import type { TaskCreate, TaskListQuery, TaskMove, TaskPatch } from "@/lib/api/schemas";
import type { Priority, Severity, TaskSource, TaskStatus } from "@/lib/domain";
import { containsPattern } from "@/lib/filters/params";
import { andAll } from "@/lib/filters/sql";
import type { MemberRef } from "./members";
import type { Upserted } from "./plans";
import { isoTimestamp, limitOffset, type Listed, splitTotal } from "./sql-helpers";

export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  assignee_id: number | null;
  assignee: MemberRef | null;
  due_date: string | null;
  /** True when the task is not done and its due date has passed. */
  overdue: boolean;
  labels: string[];
  sort_order: number;
  plan_id: number | null;
  plan: { id: number; title: string } | null;
  page_id: number | null;
  page: { id: number; path: string } | null;
  audit_issue_id: number | null;
  audit_issue: { id: number; rule: string; severity: Severity; url: string } | null;
  source: TaskSource;
  evidence: Record<string, unknown> | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Gap left between neighbouring cards so a move rewrites a single row. */
const ORDER_STEP = 1000;
/** Below this gap the column is renumbered before inserting between two cards. */
const MIN_GAP = 1e-6;

const TASK_COLUMNS = sql`
  t.id, t.title, t.description, t.status, t.priority, t.assignee_id,
  CASE WHEN m.id IS NULL THEN NULL
       ELSE jsonb_build_object('id', m.id, 'name', m.name, 'color', m.color) END AS assignee,
  t.due_date::text AS due_date,
  (t.status <> 'done' AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE) AS overdue,
  t.labels, t.sort_order, t.plan_id,
  CASE WHEN c.id IS NULL THEN NULL
       ELSE jsonb_build_object('id', c.id, 'title', c.title) END AS plan,
  t.page_id,
  CASE WHEN p.id IS NULL THEN NULL
       ELSE jsonb_build_object('id', p.id, 'path', p.path) END AS page,
  t.audit_issue_id,
  CASE WHEN i.id IS NULL THEN NULL
       ELSE jsonb_build_object('id', i.id, 'rule', i.rule, 'severity', i.severity, 'url', i.url)
  END AS audit_issue,
  t.source, t.evidence,
  ${isoTimestamp(sql`t.completed_at`)} AS completed_at,
  ${isoTimestamp(sql`t.created_at`)} AS created_at,
  ${isoTimestamp(sql`t.updated_at`)} AS updated_at`;

const TASK_FROM = sql`
  FROM tasks t
  LEFT JOIN members m ON m.id = t.assignee_id
  LEFT JOIN content_plans c ON c.id = t.plan_id
  LEFT JOIN pages p ON p.id = t.page_id
  LEFT JOIN audit_issues i ON i.id = t.audit_issue_id`;

const STATUS_ORDER = sql`array_position(
  ARRAY['backlog', 'todo', 'in_progress', 'review', 'done'], t.status)`;

export async function listTasks(query: TaskListQuery): Promise<Listed<Task>> {
  const conditions: SQL[] = [];
  if (query.status) conditions.push(sql`t.status = ${query.status}`);
  if (query.priority) conditions.push(sql`t.priority = ${query.priority}`);
  if (query.assignee_id) conditions.push(sql`t.assignee_id = ${query.assignee_id}`);
  if (query.label) conditions.push(sql`${query.label} = ANY(t.labels)`);
  if (query.source) conditions.push(sql`t.source = ${query.source}`);
  if (query.plan_id) conditions.push(sql`t.plan_id = ${query.plan_id}`);
  if (query.due === "overdue") {
    conditions.push(sql`t.status <> 'done' AND t.due_date < CURRENT_DATE`);
  } else if (query.due === "week") {
    conditions.push(
      sql`t.status <> 'done' AND t.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7`,
    );
  } else if (query.due === "none") {
    conditions.push(sql`t.due_date IS NULL`);
  }
  if (query.q) {
    const pattern = containsPattern(query.q);
    conditions.push(sql`(t.title ILIKE ${pattern} OR t.description ILIKE ${pattern})`);
  }
  const rows = await queryRows<Task & { total: number }>(sql`
    SELECT ${TASK_COLUMNS}, (count(*) OVER ())::int AS total
    ${TASK_FROM}
    WHERE ${andAll(conditions)}
    ORDER BY ${STATUS_ORDER}, t.sort_order, t.id
    ${limitOffset(query.page, query.page_size)}
  `);
  return splitTotal(rows);
}

export async function getTask(id: number): Promise<Task> {
  const [row] = await queryRows<Task>(sql`SELECT ${TASK_COLUMNS} ${TASK_FROM} WHERE t.id = ${id}`);
  if (!row) throw notFound("Task");
  return row;
}

async function endOfColumn(status: TaskStatus): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${tasks.sortOrder})` })
    .from(tasks)
    .where(eq(tasks.status, status));
  return (row?.max ?? 0) + ORDER_STEP;
}

export async function createTask(input: TaskCreate): Promise<Upserted<Task>> {
  const [inserted] = await db
    .insert(tasks)
    .values({
      title: input.title,
      description: input.description ?? null,
      status: input.status,
      priority: input.priority,
      assigneeId: input.assignee_id ?? null,
      dueDate: input.due_date ?? null,
      labels: input.labels,
      sortOrder: await endOfColumn(input.status),
      planId: input.plan_id ?? null,
      pageId: input.page_id ?? null,
      auditIssueId: input.audit_issue_id ?? null,
      source: input.source,
      dedupeKey: input.dedupe_key ?? null,
      evidence: input.evidence ?? null,
      completedAt: input.status === "done" ? new Date() : null,
    })
    .onConflictDoNothing({ target: tasks.dedupeKey })
    .returning({ id: tasks.id });
  if (inserted) return { record: await getTask(inserted.id), deduplicated: false };

  const [existing] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.dedupeKey, input.dedupe_key ?? ""));
  if (!existing) throw notFound("Task");
  return { record: await getTask(existing.id), deduplicated: true };
}

export async function updateTask(id: number, patch: TaskPatch): Promise<Task> {
  const [current] = await db.select({ status: tasks.status }).from(tasks).where(eq(tasks.id, id));
  if (!current) throw notFound("Task");

  const changes: Partial<typeof tasks.$inferInsert> = {};
  if (patch.title !== undefined) changes.title = patch.title;
  if (patch.description !== undefined) changes.description = patch.description;
  if (patch.priority !== undefined) changes.priority = patch.priority;
  if (patch.assignee_id !== undefined) changes.assigneeId = patch.assignee_id;
  if (patch.due_date !== undefined) changes.dueDate = patch.due_date;
  if (patch.labels !== undefined) changes.labels = patch.labels;
  if (patch.plan_id !== undefined) changes.planId = patch.plan_id;
  if (patch.page_id !== undefined) changes.pageId = patch.page_id;
  if (patch.audit_issue_id !== undefined) changes.auditIssueId = patch.audit_issue_id;
  if (patch.sort_order !== undefined) changes.sortOrder = patch.sort_order;
  if (patch.status !== undefined && patch.status !== current.status) {
    changes.status = patch.status;
    changes.completedAt = patch.status === "done" ? new Date() : null;
    // A status change without an explicit position lands at the end of the new column.
    if (patch.sort_order === undefined) changes.sortOrder = await endOfColumn(patch.status);
  }
  if (Object.keys(changes).length > 0) {
    await db.update(tasks).set(changes).where(eq(tasks.id, id));
  }
  return getTask(id);
}

export async function deleteTask(id: number): Promise<void> {
  const deleted = await db.delete(tasks).where(eq(tasks.id, id)).returning({ id: tasks.id });
  if (deleted.length === 0) throw notFound("Task");
}

/** Sort value halfway between two neighbours, or one step past the only neighbour. */
export function orderBetween(before: number | null, after: number | null): number {
  if (before !== null && after !== null) return (before + after) / 2;
  if (before !== null) return before + ORDER_STEP;
  if (after !== null) return after - ORDER_STEP;
  return ORDER_STEP;
}

async function neighbourOrder(id: number | null, status: TaskStatus): Promise<number | null> {
  if (id === null) return null;
  const [row] = await db
    .select({ sortOrder: tasks.sortOrder })
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.status, status)));
  return row?.sortOrder ?? null;
}

async function renumberColumn(status: TaskStatus): Promise<void> {
  await db.execute(sql`
    UPDATE tasks t SET sort_order = ranked.position * ${ORDER_STEP}
    FROM (
      SELECT id, row_number() OVER (ORDER BY sort_order, id) AS position
      FROM tasks WHERE status = ${status}
    ) ranked
    WHERE ranked.id = t.id
  `);
}

/**
 * Move a card to a column and position, given the cards that should end up
 * directly above (`before_id`) and below (`after_id`) it.
 *
 * A neighbour that is no longer in the target column (someone else moved it
 * meanwhile) is ignored; with no usable neighbour the card goes to the end.
 */
export async function moveTask(move: TaskMove): Promise<Task> {
  const [current] = await db
    .select({ status: tasks.status })
    .from(tasks)
    .where(eq(tasks.id, move.id));
  if (!current) throw notFound("Task");

  let before = await neighbourOrder(move.before_id, move.status);
  let after = await neighbourOrder(move.after_id, move.status);
  if (before !== null && after !== null && Math.abs(after - before) < MIN_GAP) {
    await renumberColumn(move.status);
    before = await neighbourOrder(move.before_id, move.status);
    after = await neighbourOrder(move.after_id, move.status);
  }
  const sortOrder =
    before === null && after === null
      ? await endOfColumn(move.status)
      : orderBetween(before, after);

  const changes: Partial<typeof tasks.$inferInsert> = { status: move.status, sortOrder };
  if (move.status !== current.status) {
    changes.completedAt = move.status === "done" ? new Date() : null;
  }
  await db.update(tasks).set(changes).where(eq(tasks.id, move.id));
  return getTask(move.id);
}

export async function listLabels(): Promise<string[]> {
  const rows = await queryRows<{ label: string }>(
    sql`SELECT DISTINCT unnest(labels) AS label FROM tasks ORDER BY label`,
  );
  return rows.map((row) => row.label);
}

/** Open tasks that are overdue or due within `days`, soonest first. */
export async function listDueSoon(days: number, limit: number): Promise<Task[]> {
  const rows = await queryRows<Task>(sql`
    SELECT ${TASK_COLUMNS}
    ${TASK_FROM}
    WHERE t.status <> 'done' AND t.due_date <= CURRENT_DATE + ${days}::int
    ORDER BY t.due_date, ${sql`array_position(ARRAY['urgent', 'high', 'medium', 'low'], t.priority)`}, t.id
    LIMIT ${limit}
  `);
  return rows;
}
