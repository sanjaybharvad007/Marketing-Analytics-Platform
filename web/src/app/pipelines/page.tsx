import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Panel, PanelHeader } from "@/components/ui/panel";
import { Pagination, Table, TableWrap, Td, Th } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { type PipelineName, PIPELINE_LABELS, PIPELINES, type RunStatus } from "@/lib/domain";
import {
  normalizeParams,
  parseLenient,
  type RawParams,
  serializeParams,
} from "@/lib/filters/params";
import { formatDate, formatDateTime, formatInteger } from "@/lib/format";
import { runListSchema } from "@/lib/api/schemas";
import { getFreshness, listPipelineRuns } from "@/lib/services/pipelines";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pipelines" };

const PAGE_SIZE = 25;
const pageSchema = runListSchema.extend({
  page_size: runListSchema.shape.page_size.default(PAGE_SIZE),
});

const STATUS_STYLE: Record<
  RunStatus,
  { icon: typeof CircleCheck; className: string; label: string }
> = {
  success: { icon: CircleCheck, className: "text-good-text", label: "Succeeded" },
  failed: { icon: CircleAlert, className: "text-bad-text", label: "Failed" },
  running: { icon: LoaderCircle, className: "text-ink-3", label: "Running" },
};

function StatusLabel({ status }: { status: RunStatus }) {
  const { icon: Icon, className, label } = STATUS_STYLE[status];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Icon aria-hidden="true" className={cn("size-3.5", className)} strokeWidth={2.25} />
      {label}
    </span>
  );
}

function duration(seconds: number | null): string {
  if (seconds === null) return "–";
  return seconds < 60
    ? `${seconds.toFixed(1)} s`
    : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

export default async function PipelinesPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const state = parseLenient(pageSchema, normalizeParams(await searchParams));
  const [freshness, runs] = await Promise.all([getFreshness(), listPipelineRuns(state)]);
  const hrefFor = (changes: Partial<typeof state>) => {
    const params = serializeParams(pageSchema, { ...state, ...changes });
    const query = params.toString();
    return query ? `/pipelines?${query}` : "/pipelines";
  };

  return (
    <>
      <PageHeader
        title="Pipelines"
        description="Each source is loaded by a pipeline run. Runs are idempotent: re-running a window replaces that window's rows."
      />

      <Panel aria-label="Freshness by source">
        <ul className="grid sm:grid-cols-2 xl:grid-cols-4">
          {freshness.map((source, index) => {
            const run = source.last_run;
            return (
              <li
                key={source.pipeline}
                className={cn(
                  "border-line px-4 py-3.5",
                  index > 0 && "border-t sm:border-t-0",
                  index % 2 === 1 && "sm:border-l",
                  index >= 2 && "sm:border-t xl:border-t-0",
                  index > 0 && "xl:border-l",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="narrow truncate text-base font-semibold">
                    {PIPELINE_LABELS[source.pipeline]}
                  </h2>
                  {run ? (
                    <Badge tone={run.mode === "demo" ? "warning" : "accent"}>
                      {run.mode === "demo" ? "Demo" : "Live"}
                    </Badge>
                  ) : null}
                </div>
                <p className="narrow mt-1 text-xl leading-7 font-semibold">
                  {source.days_behind === null
                    ? "No data"
                    : source.days_behind <= 1
                      ? "Up to date"
                      : `${source.days_behind} days behind`}
                </p>
                <dl className="num mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
                  <dt className="text-ink-3">Newest data</dt>
                  <dd>{source.newest_data ? formatDate(source.newest_data, "long") : "–"}</dd>
                  <dt className="text-ink-3">Last run</dt>
                  <dd>{run ? <StatusLabel status={run.status} /> : "Never"}</dd>
                  <dt className="text-ink-3">Last success</dt>
                  <dd>{formatDateTime(source.last_success_at)}</dd>
                </dl>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel className="mt-4 overflow-hidden" aria-labelledby="run-history">
        <PanelHeader
          id="run-history"
          title="Run history"
          actions={
            <nav
              aria-label="Filter runs by source"
              className="flex flex-wrap items-center gap-1 text-sm"
            >
              <Link
                href={hrefFor({ pipeline: undefined, page: 1 })}
                aria-current={state.pipeline ? undefined : "true"}
                className={cn(
                  "rounded-md px-2 py-1",
                  state.pipeline ? "text-ink-2 hover:bg-surface-3" : "bg-surface-3 font-semibold",
                )}
              >
                All sources
              </Link>
              {PIPELINES.map((pipeline: PipelineName) => (
                <Link
                  key={pipeline}
                  href={hrefFor({ pipeline, page: 1 })}
                  aria-current={state.pipeline === pipeline ? "true" : undefined}
                  className={cn(
                    "rounded-md px-2 py-1",
                    state.pipeline === pipeline
                      ? "bg-surface-3 font-semibold"
                      : "text-ink-2 hover:bg-surface-3",
                  )}
                >
                  {PIPELINE_LABELS[pipeline]}
                </Link>
              ))}
            </nav>
          }
        />
        {runs.rows.length === 0 ? (
          <EmptyState title="No runs recorded">
            Run <code className="rounded bg-surface-3 px-1">map run all</code> to load data. Every
            run is listed here with its window, row count and any error.
          </EmptyState>
        ) : (
          <>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Source</Th>
                    <Th>Status</Th>
                    <Th>Mode</Th>
                    <Th>Started</Th>
                    <Th align="right">Duration</Th>
                    <Th>Window</Th>
                    <Th align="right">Rows loaded</Th>
                    <Th>Error</Th>
                  </tr>
                </thead>
                <tbody>
                  {runs.rows.map((run) => (
                    <tr key={run.id} className="hover:bg-surface-2">
                      <Td className="font-medium whitespace-nowrap">
                        {PIPELINE_LABELS[run.pipeline]}
                      </Td>
                      <Td>
                        <StatusLabel status={run.status} />
                      </Td>
                      <Td>
                        <Badge tone={run.mode === "demo" ? "warning" : "accent"}>
                          {run.mode === "demo" ? "Demo" : "Live"}
                        </Badge>
                      </Td>
                      <Td className="num whitespace-nowrap">{formatDateTime(run.started_at)}</Td>
                      <Td align="right" className="whitespace-nowrap">
                        {duration(run.duration_seconds)}
                      </Td>
                      <Td className="num whitespace-nowrap">
                        {formatDate(run.window_start)} to {formatDate(run.window_end, "long")}
                      </Td>
                      <Td align="right">{formatInteger(run.rows_loaded)}</Td>
                      <Td className="max-w-80">
                        {run.error ? (
                          <span className="block truncate text-bad-text" title={run.error}>
                            {run.error}
                          </span>
                        ) : (
                          <span className="text-ink-3">–</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
            <Pagination
              page={state.page}
              pageSize={state.page_size}
              total={runs.total}
              hrefFor={(page) => hrefFor({ page })}
            />
          </>
        )}
      </Panel>
    </>
  );
}
