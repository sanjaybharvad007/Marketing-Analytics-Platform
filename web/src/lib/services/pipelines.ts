/** Pipeline runs and data freshness per source. */
import { type SQL, sql } from "drizzle-orm";
import { queryRows } from "@/db/client";
import type { RunListQuery } from "@/lib/api/schemas";
import { type PipelineName, PIPELINES, type RunStatus } from "@/lib/domain";
import { andAll } from "@/lib/filters/sql";
import { isoTimestamp, limitOffset, type Listed, splitTotal } from "./sql-helpers";

export interface PipelineRun {
  id: number;
  pipeline: PipelineName;
  mode: "demo" | "live";
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  duration_seconds: number | null;
  rows_loaded: number;
  window_start: string;
  window_end: string;
  error: string | null;
}

const RUN_COLUMNS = sql`
  r.id, r.pipeline, r.mode, r.status,
  ${isoTimestamp(sql`r.started_at`)} AS started_at,
  ${isoTimestamp(sql`r.finished_at`)} AS finished_at,
  extract(epoch FROM r.finished_at - r.started_at)::float8 AS duration_seconds,
  r.rows_loaded, r.window_start::text AS window_start, r.window_end::text AS window_end, r.error`;

export async function listPipelineRuns(query: RunListQuery): Promise<Listed<PipelineRun>> {
  const conditions: SQL[] = [];
  if (query.pipeline) conditions.push(sql`r.pipeline = ${query.pipeline}`);
  if (query.status) conditions.push(sql`r.status = ${query.status}`);
  if (query.mode) conditions.push(sql`r.mode = ${query.mode}`);
  const rows = await queryRows<PipelineRun & { total: number }>(sql`
    SELECT ${RUN_COLUMNS}, (count(*) OVER ())::int AS total
    FROM pipeline_runs r
    WHERE ${andAll(conditions)}
    ORDER BY r.started_at DESC, r.id DESC
    ${limitOffset(query.page, query.page_size)}
  `);
  return splitTotal(rows);
}

export interface Freshness {
  pipeline: PipelineName;
  last_run: PipelineRun | null;
  last_success_at: string | null;
  /** Newest date present in the source's fact table. */
  newest_data: string | null;
  /** Whole days between `newest_data` and today (UTC). */
  days_behind: number | null;
}

export async function getFreshness(): Promise<Freshness[]> {
  const [lastRuns, successes, newest] = await Promise.all([
    queryRows<PipelineRun>(sql`
      SELECT DISTINCT ON (r.pipeline) ${RUN_COLUMNS}
      FROM pipeline_runs r
      ORDER BY r.pipeline, r.started_at DESC, r.id DESC
    `),
    queryRows<{ pipeline: PipelineName; finished_at: string }>(sql`
      SELECT r.pipeline, ${isoTimestamp(sql`max(r.finished_at)`)} AS finished_at
      FROM pipeline_runs r WHERE r.status = 'success' GROUP BY r.pipeline
    `),
    queryRows<{ pipeline: PipelineName; newest: string | null; days_behind: number | null }>(sql`
      SELECT x.pipeline, x.newest::text AS newest, (CURRENT_DATE - x.newest)::int AS days_behind
      FROM (
        SELECT 'ga4' AS pipeline, (SELECT max(date) FROM ga_daily) AS newest
        UNION ALL SELECT 'gsc', (SELECT max(date) FROM gsc_daily)
        UNION ALL SELECT 'seo', (SELECT max(date) FROM keyword_rankings)
        UNION ALL SELECT 'ai_visibility', (SELECT max(date) FROM ai_visibility_results)
      ) x
    `),
  ]);
  return PIPELINES.map((pipeline) => {
    const data = newest.find((row) => row.pipeline === pipeline);
    return {
      pipeline,
      last_run: lastRuns.find((row) => row.pipeline === pipeline) ?? null,
      last_success_at: successes.find((row) => row.pipeline === pipeline)?.finished_at ?? null,
      newest_data: data?.newest ?? null,
      days_behind: data?.days_behind ?? null,
    };
  });
}
