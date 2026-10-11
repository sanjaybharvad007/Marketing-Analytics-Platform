/** Site audits: runs, issues, ingest from the crawler, and issue triage. */
import { desc, eq, type SQL, sql } from "drizzle-orm";
import { db, queryRows } from "@/db/client";
import { auditIssues, auditRuns } from "@/db/schema";
import { notFound } from "@/lib/api/errors";
import type { AuditIngest, IssueListQuery } from "@/lib/api/schemas";
import { type IssueStatus, SEVERITIES, type Severity } from "@/lib/domain";
import { containsPattern } from "@/lib/filters/params";
import { andAll } from "@/lib/filters/sql";
import { isoTimestamp, limitOffset, type Listed, splitTotal } from "./sql-helpers";

export interface AuditRun {
  id: number;
  site_url: string;
  started_at: string;
  finished_at: string;
  pages_crawled: number;
  issues_total: number;
  health_score: number;
  summary: string | null;
  summary_source: "heuristic" | "llm";
  created_at: string;
}

export interface AuditIssue {
  id: number;
  run_id: number;
  page_id: number | null;
  url: string;
  path: string;
  rule: string;
  severity: Severity;
  message: string;
  details: Record<string, unknown>;
  status: IssueStatus;
  /** A task already linked to this issue, if any. */
  task_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface RuleCount {
  rule: string;
  severity: Severity;
  count: number;
}

export interface AuditOverview {
  run: AuditRun | null;
  /** Counts of open issues in the latest run. */
  counts: {
    open: number;
    by_severity: Record<Severity, number>;
    by_rule: RuleCount[];
  };
  previous: Pick<AuditRun, "id" | "health_score" | "issues_total" | "finished_at"> | null;
}

const RUN_COLUMNS = sql`
  r.id, r.site_url,
  ${isoTimestamp(sql`r.started_at`)} AS started_at,
  ${isoTimestamp(sql`r.finished_at`)} AS finished_at,
  r.pages_crawled, r.issues_total, r.health_score::float8 AS health_score,
  r.summary, r.summary_source,
  ${isoTimestamp(sql`r.created_at`)} AS created_at`;

// A task opened for an issue in an earlier run still covers the same rule and
// URL in later runs; the dedupe key is what ties them together.
const ISSUE_COLUMNS = sql`
  i.id, i.run_id, i.page_id, i.url,
  regexp_replace(i.url, '^https?://[^/]+', '') AS path,
  i.rule, i.severity, i.message, i.details, i.status,
  (SELECT min(t.id) FROM tasks t
    WHERE t.audit_issue_id = i.id
       OR t.dedupe_key = 'audit:' || i.rule || ':' || i.url) AS task_id,
  ${isoTimestamp(sql`i.created_at`)} AS created_at,
  ${isoTimestamp(sql`i.updated_at`)} AS updated_at`;

const SEVERITY_ORDER = sql`array_position(ARRAY['critical', 'high', 'medium', 'low'], i.severity)`;

export async function listRuns(page: number, pageSize: number): Promise<Listed<AuditRun>> {
  const rows = await queryRows<AuditRun & { total: number }>(sql`
    SELECT ${RUN_COLUMNS}, (count(*) OVER ())::int AS total
    FROM audit_runs r
    ORDER BY r.finished_at DESC, r.id DESC
    ${limitOffset(page, pageSize)}
  `);
  return splitTotal(rows);
}

export async function latestRunId(): Promise<number | null> {
  const [row] = await db
    .select({ id: auditRuns.id })
    .from(auditRuns)
    .orderBy(desc(auditRuns.finishedAt), desc(auditRuns.id))
    .limit(1);
  return row?.id ?? null;
}

export async function getAuditOverview(): Promise<AuditOverview> {
  const runs = await queryRows<AuditRun>(sql`
    SELECT ${RUN_COLUMNS} FROM audit_runs r ORDER BY r.finished_at DESC, r.id DESC LIMIT 2
  `);
  const [run, previous] = runs;
  const by_severity = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<
    Severity,
    number
  >;
  if (!run) return { run: null, counts: { open: 0, by_severity, by_rule: [] }, previous: null };

  const by_rule = await queryRows<RuleCount>(sql`
    SELECT i.rule, i.severity, count(*)::int AS count
    FROM audit_issues i
    WHERE i.run_id = ${run.id} AND i.status = 'open'
    GROUP BY i.rule, i.severity
    ORDER BY ${SEVERITY_ORDER}, count(*) DESC, i.rule
  `);
  for (const row of by_rule) by_severity[row.severity] += row.count;
  return {
    run,
    counts: {
      open: by_rule.reduce((sum, row) => sum + row.count, 0),
      by_severity,
      by_rule: [...by_rule],
    },
    previous: previous
      ? {
          id: previous.id,
          health_score: previous.health_score,
          issues_total: previous.issues_total,
          finished_at: previous.finished_at,
        }
      : null,
  };
}

/** Issues of one run (the latest by default), most severe first. */
export async function listIssues(
  query: IssueListQuery,
): Promise<Listed<AuditIssue> & { run_id: number | null }> {
  const runId = query.run_id ?? (await latestRunId());
  if (runId === null) return { rows: [], total: 0, run_id: null };
  const conditions: SQL[] = [sql`i.run_id = ${runId}`];
  if (query.severity) conditions.push(sql`i.severity = ${query.severity}`);
  if (query.rule) conditions.push(sql`i.rule = ${query.rule}`);
  if (query.status) conditions.push(sql`i.status = ${query.status}`);
  if (query.q) {
    const pattern = containsPattern(query.q);
    conditions.push(sql`(i.url ILIKE ${pattern} OR i.message ILIKE ${pattern})`);
  }
  const rows = await queryRows<AuditIssue & { total: number }>(sql`
    SELECT ${ISSUE_COLUMNS}, (count(*) OVER ())::int AS total
    FROM audit_issues i
    WHERE ${andAll(conditions)}
    ORDER BY ${SEVERITY_ORDER}, i.rule, i.url
    ${limitOffset(query.page, query.page_size)}
  `);
  return { ...splitTotal(rows), run_id: runId };
}

export async function getIssue(id: number): Promise<AuditIssue> {
  const [row] = await queryRows<AuditIssue>(
    sql`SELECT ${ISSUE_COLUMNS} FROM audit_issues i WHERE i.id = ${id}`,
  );
  if (!row) throw notFound("Audit issue");
  return row;
}

export async function updateIssueStatus(id: number, status: IssueStatus): Promise<AuditIssue> {
  const [updated] = await db
    .update(auditIssues)
    .set({ status })
    .where(eq(auditIssues.id, id))
    .returning({ id: auditIssues.id });
  if (!updated) throw notFound("Audit issue");
  return getIssue(id);
}

export interface IngestedAudit {
  run: AuditRun;
  issues: Array<Pick<AuditIssue, "id" | "url" | "rule" | "severity" | "status" | "page_id">>;
}

/**
 * Store a crawl: the run, its issues, and what the crawler learned about each
 * page. Runs in one transaction.
 *
 * An issue that was marked "ignored" in the previous run stays ignored when it
 * reappears, so triage decisions survive re-crawls.
 */
export async function ingestAudit(input: AuditIngest): Promise<IngestedAudit> {
  const runId = await db.transaction(async (tx) => {
    const [previous] = await tx
      .select({ id: auditRuns.id })
      .from(auditRuns)
      .orderBy(desc(auditRuns.finishedAt), desc(auditRuns.id))
      .limit(1);

    const [run] = await tx
      .insert(auditRuns)
      .values({
        siteUrl: input.site_url,
        startedAt: new Date(input.started_at),
        finishedAt: new Date(input.finished_at),
        pagesCrawled: input.pages_crawled,
        issuesTotal: input.issues.length,
        healthScore: input.health_score.toFixed(1),
        summary: input.summary ?? null,
        summarySource: input.summary_source,
      })
      .returning({ id: auditRuns.id });
    if (!run) throw new Error("audit run insert returned no row");

    if (input.issues.length > 0) {
      const payload = JSON.stringify(input.issues);
      await tx.execute(sql`
        INSERT INTO audit_issues (run_id, page_id, url, rule, severity, message, details, status)
        SELECT ${run.id}, p.id, x.url, x.rule, x.severity, x.message, COALESCE(x.details, '{}'::jsonb),
               CASE WHEN old.status = 'ignored' THEN 'ignored' ELSE 'open' END
        FROM jsonb_to_recordset(${payload}::jsonb)
             AS x(url text, rule text, severity text, message text, details jsonb)
        LEFT JOIN pages p ON p.url = x.url
        LEFT JOIN audit_issues old
               ON old.run_id = ${previous?.id ?? null} AND old.rule = x.rule AND old.url = x.url
        ON CONFLICT (run_id, rule, url) DO NOTHING
      `);
    }

    if (input.pages.length > 0) {
      const payload = JSON.stringify(input.pages);
      await tx.execute(sql`
        UPDATE pages p
        SET status_code = COALESCE(x.status_code, p.status_code),
            word_count = COALESCE(x.word_count, p.word_count),
            title = COALESCE(p.title, NULLIF(x.title, '')),
            last_seen_at = now()
        FROM jsonb_to_recordset(${payload}::jsonb)
             AS x(url text, status_code integer, word_count integer, title text)
        WHERE p.url = x.url
      `);
    }
    return run.id;
  });

  const [run] = await queryRows<AuditRun>(
    sql`SELECT ${RUN_COLUMNS} FROM audit_runs r WHERE r.id = ${runId}`,
  );
  if (!run) throw notFound("Audit run");
  const issues = await queryRows<IngestedAudit["issues"][number]>(sql`
    SELECT i.id, i.url, i.rule, i.severity, i.status, i.page_id
    FROM audit_issues i WHERE i.run_id = ${runId}
    ORDER BY ${SEVERITY_ORDER}, i.rule, i.url
  `);
  return { run, issues: [...issues] };
}

export interface RunHistoryPoint {
  id: number;
  date: string;
  health_score: number;
  issues_total: number;
}

/** Health score per run, oldest first, for the history chart. */
export async function getRunHistory(limit = 30): Promise<RunHistoryPoint[]> {
  const rows = await queryRows<RunHistoryPoint>(sql`
    SELECT id, to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
           health_score::float8 AS health_score, issues_total
    FROM audit_runs
    ORDER BY finished_at DESC, id DESC
    LIMIT ${limit}
  `);
  return [...rows].reverse();
}

export async function listIssueRules(runId: number): Promise<string[]> {
  const rows = await queryRows<{ rule: string }>(
    sql`SELECT DISTINCT rule FROM audit_issues WHERE run_id = ${runId} ORDER BY rule`,
  );
  return rows.map((row) => row.rule);
}
