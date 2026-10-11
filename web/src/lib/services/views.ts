/** Saved report views: named filter sets stored in Postgres. */
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { savedViews } from "@/db/schema";
import { notFound } from "@/lib/api/errors";
import type { ViewCreate } from "@/lib/api/schemas";
import type { Report } from "@/lib/domain";

export interface SavedView {
  id: number;
  name: string;
  report: Report;
  filters: Record<string, unknown>;
  created_at: string;
}

const columns = {
  id: savedViews.id,
  name: savedViews.name,
  report: savedViews.report,
  filters: savedViews.filters,
  createdAt: savedViews.createdAt,
};

function toView(row: {
  id: number;
  name: string;
  report: Report;
  filters: Record<string, unknown>;
  createdAt: Date;
}): SavedView {
  return {
    id: row.id,
    name: row.name,
    report: row.report,
    filters: row.filters,
    created_at: row.createdAt.toISOString(),
  };
}

export async function listViews(report?: Report): Promise<SavedView[]> {
  const rows = await db
    .select(columns)
    .from(savedViews)
    .where(report ? eq(savedViews.report, report) : undefined)
    .orderBy(asc(savedViews.report), asc(savedViews.name));
  return rows.map(toView);
}

/** Create a view. A second view with the same name in a report is a conflict (409). */
export async function createView(input: ViewCreate): Promise<SavedView> {
  const [row] = await db
    .insert(savedViews)
    .values({ name: input.name, report: input.report, filters: input.filters })
    .returning(columns);
  if (!row) throw new Error("saved view insert returned no row");
  return toView(row);
}

export async function deleteView(id: number, report?: Report): Promise<void> {
  const deleted = await db
    .delete(savedViews)
    .where(
      report ? and(eq(savedViews.id, id), eq(savedViews.report, report)) : eq(savedViews.id, id),
    )
    .returning({ id: savedViews.id });
  if (deleted.length === 0) throw notFound("Saved view");
}
