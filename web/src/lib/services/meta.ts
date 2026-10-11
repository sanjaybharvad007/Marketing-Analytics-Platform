/** Workspace-level facts every page needs: the newest data date and demo status. */
import { sql } from "drizzle-orm";
import { cache } from "react";
import { queryRows } from "@/db/client";
import { addDays, todayIso } from "@/lib/dates";
import { PIPELINES, type PipelineName } from "@/lib/domain";

/**
 * The newest date with search or traffic data. Date presets end here, so a
 * dashboard never shows a trailing gap while the pipelines catch up.
 */
export const getDataAnchor = cache(async (): Promise<string> => {
  const [row] = await queryRows<{ latest: string | null }>(sql`
    SELECT GREATEST(
      (SELECT max(date) FROM mv_search_page_daily),
      (SELECT max(date) FROM mv_traffic_daily)
    )::text AS latest
  `);
  return row?.latest ?? addDays(todayIso(), -1);
});

export interface WorkspaceStatus {
  /** True when the most recent successful run of any pipeline loaded demo data. */
  demo: boolean;
  demoPipelines: PipelineName[];
  hasData: boolean;
}

export const getWorkspaceStatus = cache(async (): Promise<WorkspaceStatus> => {
  const rows = await queryRows<{ pipeline: PipelineName; mode: "demo" | "live" }>(sql`
    SELECT DISTINCT ON (pipeline) pipeline, mode
    FROM pipeline_runs
    WHERE status = 'success'
    ORDER BY pipeline, started_at DESC
  `);
  const demoPipelines = PIPELINES.filter((name) =>
    rows.some((row) => row.pipeline === name && row.mode === "demo"),
  );
  return { demo: demoPipelines.length > 0, demoPipelines, hasData: rows.length > 0 };
});

/**
 * Today's date according to the database, the same clock that decides whether
 * a task is overdue. Using one clock keeps "due in 2 days" and the overdue
 * flag consistent whatever time zone the web server runs in.
 */
export const getToday = cache(async (): Promise<string> => {
  const [row] = await queryRows<{ today: string }>(sql`SELECT CURRENT_DATE::text AS today`);
  return row?.today ?? todayIso();
});
