import Link from "next/link";
import { AuditFilters } from "@/components/audits/audit-filters";
import { HistoryChart } from "@/components/audits/history-chart";
import { IssueTable } from "@/components/audits/issue-table";
import { BarList } from "@/components/charts/bar-list";
import { FilterScope, PendingRegion } from "@/components/shell/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { SeverityLabel } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { DeltaLabel } from "@/components/ui/delta";
import { EmptyState, Panel, PanelHeader } from "@/components/ui/panel";
import { Pagination } from "@/components/ui/table";
import { humanize, SEVERITIES } from "@/lib/domain";
import { auditsStateToParams, parseAuditsState } from "@/lib/filters/audits";
import type { RawParams } from "@/lib/filters/params";
import { formatDateTime } from "@/lib/format";
import { getAuditOverview, getRunHistory, listIssueRules, listIssues } from "@/lib/services/audits";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audits" };

const PAGE_SIZE = 25;

/** Render the stored plain-text summary: paragraphs, numbered priorities, bullet lists. */
function Summary({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let numbered: string[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (numbered.length > 0) {
      blocks.push(
        <ol key={blocks.length} className="list-decimal space-y-1 pl-5">
          {numbered.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>,
      );
      numbered = [];
    }
    if (bullets.length > 0) {
      blocks.push(
        <ul key={blocks.length} className="list-disc space-y-1 pl-5">
          {bullets.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const ordered = /^\d+\.\s+(.*)$/.exec(line);
    if (ordered?.[1]) {
      numbered.push(ordered[1]);
    } else if (line.startsWith("- ")) {
      bullets.push(line.slice(2));
    } else {
      flush();
      const heading = line.length < 24 && !/[.:]$/.test(line);
      blocks.push(
        heading ? (
          <h3 key={blocks.length} className="narrow pt-1 text-base font-semibold text-ink">
            {line}
          </h3>
        ) : (
          <p key={blocks.length}>{line}</p>
        ),
      );
    }
  }
  flush();
  return <div className="flex flex-col gap-2 text-sm leading-6 text-ink-2">{blocks}</div>;
}

export default async function AuditsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const state = parseAuditsState(await searchParams);
  const overview = await getAuditOverview();
  const run = overview.run;

  if (!run) {
    return (
      <>
        <PageHeader title="Audits" />
        <Panel>
          <EmptyState title="No audit has run yet">
            Start the demo site with{" "}
            <code className="rounded bg-surface-3 px-1">map serve-demo-site</code> and run{" "}
            <code className="rounded bg-surface-3 px-1">map audit</code>, or point{" "}
            <code className="rounded bg-surface-3 px-1">map audit --url</code> at your own site. The
            crawl results appear here.
          </EmptyState>
        </Panel>
      </>
    );
  }

  const [issues, history, rules] = await Promise.all([
    listIssues({ ...state, run_id: run.id, page_size: PAGE_SIZE }),
    getRunHistory(),
    listIssueRules(run.id),
  ]);
  const exportParams = auditsStateToParams({ ...state, page: 1 });
  exportParams.set("run_id", String(run.id));
  exportParams.set("format", "csv");

  return (
    <FilterScope>
      <PageHeader
        title="Audits"
        description={`Latest crawl of ${run.site_url.replace(/^https?:\/\//, "")} finished ${formatDateTime(run.finished_at)}: ${run.pages_crawled} pages, ${run.issues_total} issues.`}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel aria-labelledby="audit-health">
          <PanelHeader
            id="audit-health"
            title="Site health"
            description={
              run.summary_source === "llm"
                ? "Summary written by the configured language model."
                : "Summary written by the rule-based summariser."
            }
          />
          <div className="grid gap-x-6 gap-y-3 px-4 pb-4 md:grid-cols-[11rem_minmax(0,1fr)]">
            <div>
              <p className="flex items-baseline gap-2">
                <span className="narrow text-[2.75rem] leading-none font-semibold">
                  {run.health_score.toFixed(0)}
                </span>
                <span className="text-sm text-ink-3">out of 100</span>
              </p>
              <div
                role="meter"
                aria-label="Health score"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={run.health_score}
                className="mt-2 h-1.5 rounded-full bg-(--series-1-soft)"
              >
                <div
                  className="h-full rounded-full bg-series-1"
                  style={{ width: `${run.health_score}%` }}
                />
              </div>
              {overview.previous ? (
                <p className="mt-2 text-sm text-ink-3">
                  <DeltaLabel
                    current={run.health_score}
                    previous={overview.previous.health_score}
                    format="score"
                  />{" "}
                  since the previous run
                </p>
              ) : null}
              <ul className="mt-3 border-t border-line pt-2">
                {SEVERITIES.map((severity) => (
                  <li key={severity} className="flex items-center justify-between py-1 text-sm">
                    <SeverityLabel severity={severity} />
                    <Link
                      href={`/audits?${auditsStateToParams({ severity, status: "open" })}`}
                      scroll={false}
                      className="num font-semibold hover:underline"
                    >
                      {overview.counts.by_severity[severity]}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            {run.summary ? <Summary text={run.summary} /> : null}
          </div>
        </Panel>

        <div className="flex min-w-0 flex-col gap-4">
          {history.length > 1 ? <HistoryChart runs={history} /> : null}
          <Panel aria-labelledby="issues-by-rule">
            <PanelHeader
              id="issues-by-rule"
              title="Open issues by rule"
              description="Pages affected by each rule in the latest run."
            />
            <div className="px-4 pb-4">
              {overview.counts.by_rule.length === 0 ? (
                <p className="text-sm text-ink-3">No open issues.</p>
              ) : (
                <BarList
                  ariaLabel="Open issues by rule"
                  rows={overview.counts.by_rule.slice(0, 8).map((row) => ({
                    key: row.rule,
                    label: humanize(row.rule),
                    value: row.count,
                    display: String(row.count),
                    href: `/audits?${auditsStateToParams({ rule: row.rule })}`,
                  }))}
                />
              )}
            </div>
          </Panel>
        </div>
      </div>

      <Panel className="mt-4 overflow-hidden" aria-labelledby="issue-list">
        <PanelHeader
          id="issue-list"
          title="Issues in the latest run"
          actions={
            <a
              href={`/api/v1/audits/issues?${exportParams}`}
              download
              className={buttonClass("secondary", "sm")}
            >
              Export CSV
            </a>
          }
        />
        <AuditFilters state={state} rules={rules} />
        <PendingRegion>
          {issues.rows.length === 0 ? (
            <EmptyState title="No issues match these filters">
              Clear a filter to see the rest of the run.
            </EmptyState>
          ) : (
            <>
              <IssueTable issues={issues.rows} />
              <Pagination
                page={state.page}
                pageSize={PAGE_SIZE}
                total={issues.total}
                hrefFor={(page) => `/audits?${auditsStateToParams({ ...state, page })}`}
              />
            </>
          )}
        </PendingRegion>
      </Panel>
    </FilterScope>
  );
}
