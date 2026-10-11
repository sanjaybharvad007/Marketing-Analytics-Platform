import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { BarList } from "@/components/charts/bar-list";
import { KpiStrip } from "@/components/overview/kpi-strip";
import { OverviewControls } from "@/components/overview/overview-controls";
import { TrafficTrend } from "@/components/overview/traffic-trend";
import { FilterScope, PendingRegion } from "@/components/shell/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { Avatar, Badge, PriorityLabel, SeverityLabel } from "@/components/ui/badge";
import { DeltaLabel } from "@/components/ui/delta";
import { EmptyState, Panel, PanelHeader } from "@/components/ui/panel";
import { resolvePeriods } from "@/lib/dates";
import { PIPELINE_LABELS, SEVERITIES } from "@/lib/domain";
import { parseOverviewState } from "@/lib/filters/overview";
import type { RawParams } from "@/lib/filters/params";
import { seoStateToParams } from "@/lib/filters/seo";
import {
  formatCompact,
  formatDate,
  formatDateRange,
  formatInteger,
  formatPercent,
  relativeDays,
} from "@/lib/format";
import { getAuditOverview } from "@/lib/services/audits";
import { getDataAnchor, getToday, getWorkspaceStatus } from "@/lib/services/meta";
import { getChannelMix, getOverview, getPageMovers, type PageMover } from "@/lib/services/overview";
import { getFreshness } from "@/lib/services/pipelines";
import { listDueSoon } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview" };

function MoverList({
  rows,
  direction,
  seoQuery,
}: {
  rows: PageMover[];
  direction: "up" | "down";
  seoQuery: (pageId: number) => string;
}) {
  const Icon = direction === "up" ? ArrowUpRight : ArrowDownRight;
  if (rows.length === 0) {
    return <p className="px-4 pb-4 text-sm text-ink-3">No pages moved in this direction.</p>;
  }
  return (
    <ul className="px-4 pb-3">
      {rows.map((row) => (
        <li
          key={row.page_id}
          className="flex items-center justify-between gap-3 border-b border-line py-2 text-sm last:border-b-0"
        >
          <Link href={seoQuery(row.page_id)} className="min-w-0 hover:underline" title={row.path}>
            <span className="block truncate font-medium text-ink">{row.title ?? row.path}</span>
            <span className="block truncate text-xs text-ink-3">{row.path}</span>
          </Link>
          <span className="num shrink-0 text-right">
            <span
              className={`flex items-center justify-end gap-0.5 font-semibold ${
                direction === "up" ? "text-good-text" : "text-bad-text"
              }`}
            >
              <Icon aria-hidden="true" className="size-3.5" strokeWidth={2.25} />
              {direction === "up" ? "+" : "-"}
              {formatInteger(Math.abs(row.clicks_delta))}
            </span>
            <span className="block text-xs text-ink-3">
              {formatInteger(row.clicks_prev)} to {formatInteger(row.clicks)} clicks
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const state = parseOverviewState(await searchParams);
  const [anchor, status, today] = await Promise.all([
    getDataAnchor(),
    getWorkspaceStatus(),
    getToday(),
  ]);
  const periods = resolvePeriods(state, anchor);
  const [overview, channels, movers, freshness, audit, dueSoon] = await Promise.all([
    getOverview(periods),
    getChannelMix(periods),
    getPageMovers(periods),
    getFreshness(),
    getAuditOverview(),
    listDueSoon(7, 6),
  ]);
  const seoQuery = (pageId: number) =>
    `/reports/seo?${seoStateToParams({ ...state, tab: "queries", page_id: pageId })}`;

  if (!status.hasData) {
    return (
      <>
        <PageHeader title="Overview" />
        <Panel>
          <EmptyState title="No data has been loaded yet">
            Run <code className="rounded bg-surface-3 px-1">map seed-demo</code> for a demo
            workspace, or <code className="rounded bg-surface-3 px-1">map run all --mode live</code>{" "}
            once your credentials are configured. This page fills in as soon as the first pipeline
            run succeeds.
          </EmptyState>
        </Panel>
      </>
    );
  }

  return (
    <FilterScope>
      <PageHeader
        title="Overview"
        description={
          periods.previous
            ? `${formatDateRange(periods.current.from, periods.current.to)}, compared with ${formatDateRange(periods.previous.from, periods.previous.to)}`
            : formatDateRange(periods.current.from, periods.current.to)
        }
        actions={<OverviewControls state={state} resolved={periods.current} maxDate={anchor} />}
      />

      <PendingRegion className="flex flex-col gap-4">
        <KpiStrip overview={overview} />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <TrafficTrend series={overview.series} previousSeries={overview.previousSeries} />

          <Panel aria-labelledby="channel-mix">
            <PanelHeader
              id="channel-mix"
              title="Sessions by channel"
              description="Share of sessions, with change from the previous period."
            />
            <div className="px-4 pb-3">
              <BarList
                ariaLabel="Sessions by channel"
                rows={channels.map((row) => ({
                  key: row.channel,
                  label: row.channel,
                  value: row.sessions,
                  display: formatCompact(row.sessions),
                  note: (
                    <span className="flex items-center gap-2">
                      {periods.previous ? (
                        <DeltaLabel current={row.sessions} previous={row.sessions_prev} />
                      ) : null}
                      <span>{formatPercent(row.share, 0)} of sessions</span>
                    </span>
                  ),
                }))}
              />
            </div>
          </Panel>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel aria-labelledby="growing-pages">
            <PanelHeader
              id="growing-pages"
              title="Pages gaining organic clicks"
              description="Largest increases versus the previous period."
            />
            <MoverList rows={movers.growing} direction="up" seoQuery={seoQuery} />
          </Panel>
          <Panel aria-labelledby="declining-pages">
            <PanelHeader
              id="declining-pages"
              title="Pages losing organic clicks"
              description="Largest decreases versus the previous period."
            />
            <MoverList rows={movers.declining} direction="down" seoQuery={seoQuery} />
          </Panel>
        </div>
      </PendingRegion>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel aria-labelledby="freshness">
          <PanelHeader
            id="freshness"
            title="Data freshness"
            actions={
              <Link href="/pipelines" className="text-sm text-accent-text hover:underline">
                Run history
              </Link>
            }
          />
          <ul className="px-4 pb-3">
            {freshness.map((source) => (
              <li
                key={source.pipeline}
                className="flex items-center justify-between gap-3 border-b border-line py-2 text-sm last:border-b-0"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {PIPELINE_LABELS[source.pipeline]}
                  </span>
                  <span className="num block text-xs text-ink-3">
                    {source.newest_data
                      ? `Data through ${formatDate(source.newest_data)}`
                      : "No data loaded"}
                  </span>
                </span>
                {source.last_run?.status === "failed" ? (
                  <Badge tone="bad">Last run failed</Badge>
                ) : source.days_behind === null ? (
                  <Badge>Never run</Badge>
                ) : source.days_behind <= 2 ? (
                  <Badge tone="good">Up to date</Badge>
                ) : (
                  <Badge tone="warning">{source.days_behind} days behind</Badge>
                )}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel aria-labelledby="audit-snapshot">
          <PanelHeader
            id="audit-snapshot"
            title="Open audit issues"
            actions={
              <Link href="/audits" className="text-sm text-accent-text hover:underline">
                View audit
              </Link>
            }
          />
          {audit.run ? (
            <div className="px-4 pb-3">
              <p className="mb-2 text-sm text-ink-2">
                Health score{" "}
                <span className="num font-semibold text-ink">
                  {audit.run.health_score.toFixed(1)}
                </span>
                {audit.previous ? (
                  <>
                    {" "}
                    <DeltaLabel
                      current={audit.run.health_score}
                      previous={audit.previous.health_score}
                      format="score"
                    />
                  </>
                ) : null}{" "}
                from the crawl on {formatDate(audit.run.finished_at)}.
              </p>
              <ul>
                {SEVERITIES.map((severity) => (
                  <li
                    key={severity}
                    className="flex items-center justify-between border-b border-line py-1.5 text-sm last:border-b-0"
                  >
                    <SeverityLabel severity={severity} />
                    <Link
                      href={`/audits?severity=${severity}&status=open`}
                      className="num font-semibold hover:underline"
                    >
                      {audit.counts.by_severity[severity]}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="px-4 pb-4 text-sm text-ink-3">
              No audit has run yet. Run <code className="rounded bg-surface-3 px-1">map audit</code>{" "}
              to crawl the site.
            </p>
          )}
        </Panel>

        <Panel aria-labelledby="due-soon">
          <PanelHeader
            id="due-soon"
            title="Tasks due within a week"
            actions={
              <Link href="/work" className="text-sm text-accent-text hover:underline">
                Open board
              </Link>
            }
          />
          {dueSoon.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-ink-3">Nothing is due in the next seven days.</p>
          ) : (
            <ul className="px-4 pb-3">
              {dueSoon.map((task) => (
                <li
                  key={task.id}
                  className="flex items-center gap-2.5 border-b border-line py-2 text-sm last:border-b-0"
                >
                  {task.assignee ? (
                    <Avatar name={task.assignee.name} color={task.assignee.color} />
                  ) : (
                    <span className="size-5 shrink-0 rounded-full border border-dashed border-line-strong" />
                  )}
                  <Link
                    href={`/work?task=${task.id}`}
                    className="min-w-0 flex-1 truncate hover:underline"
                  >
                    {task.title}
                  </Link>
                  <PriorityLabel priority={task.priority} showLabel={false} />
                  <span
                    className={`num shrink-0 text-xs ${task.overdue ? "font-semibold text-bad-text" : "text-ink-3"}`}
                  >
                    {task.due_date ? relativeDays(task.due_date, today) : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </FilterScope>
  );
}
