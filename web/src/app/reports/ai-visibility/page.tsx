import { Check, Link2, Minus } from "lucide-react";
import Link from "next/link";
import { AiFilterBar } from "@/components/ai/ai-filter-bar";
import { AiTrend } from "@/components/ai/ai-trend";
import { ENGINE_COLORS } from "@/components/ai/engine-colors";
import { PromptDetailPanel } from "@/components/ai/prompt-detail";
import { BarList } from "@/components/charts/bar-list";
import { Legend } from "@/components/charts/chart-frame";
import { FilterScope, PendingRegion } from "@/components/shell/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { DeltaLabel } from "@/components/ui/delta";
import { EmptyState, Panel, PanelHeader } from "@/components/ui/panel";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { SCORE_WEIGHTS } from "@/lib/ai-score";
import { resolvePeriods } from "@/lib/dates";
import { type Engine, ENGINE_LABELS, ENGINES } from "@/lib/domain";
import { aiStateToParams, parseAiPageState } from "@/lib/filters/ai";
import type { RawParams } from "@/lib/filters/params";
import { formatDateRange, formatInteger, formatPercent, formatPosition } from "@/lib/format";
import {
  type EngineStatus,
  type EngineSummary,
  GAP_THRESHOLDS,
  getAiSummary,
  getPromptDetail,
  listPrompts,
  listTopics,
  type PromptRow,
} from "@/lib/services/ai-visibility";
import { getDataAnchor } from "@/lib/services/meta";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI visibility" };

const points = (weight: number) => Math.round(weight * 100);

function ScoreDefinition() {
  return (
    <Panel aria-labelledby="score-definition" className="text-sm">
      <PanelHeader id="score-definition" title="How the score is calculated" />
      <div className="px-4 pb-3.5 text-ink-2">
        <p>
          Each engine answers each tracked prompt once a day. An answer earns points for where the
          brand is named among tracked brands, plus points for citing the site:
        </p>
        <dl className="num mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
          <dt>Named first</dt>
          <dd className="text-right font-semibold text-ink">{points(SCORE_WEIGHTS.rank1)}</dd>
          <dt>Named second</dt>
          <dd className="text-right font-semibold text-ink">{points(SCORE_WEIGHTS.rank2)}</dd>
          <dt>Named third</dt>
          <dd className="text-right font-semibold text-ink">{points(SCORE_WEIGHTS.rank3)}</dd>
          <dt>Named fourth or later</dt>
          <dd className="text-right font-semibold text-ink">{points(SCORE_WEIGHTS.rank4Plus)}</dd>
          <dt>Cites a page on the site</dt>
          <dd className="text-right font-semibold text-ink">+{points(SCORE_WEIGHTS.cited)}</dd>
        </dl>
        <p className="mt-2">
          The score is the average over all answers in the period: 100 means every answer names the
          brand first and cites it, 0 means it never appears.
        </p>
      </div>
    </Panel>
  );
}

function EngineRates({ engines }: { engines: EngineSummary[] }) {
  const legend = [
    { label: "Mentioned", color: "var(--series-1)", shape: "rect" as const },
    { label: "Cited", color: "var(--series-2)", shape: "rect" as const },
  ];
  return (
    <Panel aria-labelledby="engine-rates">
      <PanelHeader
        id="engine-rates"
        title="Mention and citation rate by engine"
        description="Share of answers that name the brand, and that cite the site."
      />
      <Legend items={legend} className="px-4 pb-2" />
      <ul className="flex flex-col gap-3 px-4 pb-4">
        {engines.map((engine) => (
          <li
            key={engine.engine}
            className="grid grid-cols-[9.5rem_minmax(0,1fr)] items-center gap-x-3 text-sm"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{ENGINE_LABELS[engine.engine]}</span>
              <span className="num text-xs text-ink-3">
                Score {formatPosition(engine.score)}{" "}
                <DeltaLabel current={engine.score} previous={engine.score_prev} format="score" />
              </span>
            </span>
            <span className="flex flex-col gap-0.5">
              {[
                { value: engine.mention_rate, color: "var(--series-1)", name: "mentioned" },
                { value: engine.citation_rate, color: "var(--series-2)", name: "cited" },
              ].map((bar) => (
                <span key={bar.name} className="flex items-center gap-2">
                  <span className="block h-2 flex-1" aria-hidden="true">
                    <span
                      className="block h-full rounded-r-[4px]"
                      style={{
                        width: `${Math.max(bar.value * 100, 0.5)}%`,
                        backgroundColor: bar.color,
                      }}
                    />
                  </span>
                  <span className="num w-11 text-right text-xs font-semibold">
                    {formatPercent(bar.value, 0)}
                    <span className="sr-only"> {bar.name}</span>
                  </span>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function EngineCell({ status }: { status: EngineStatus | undefined }) {
  if (!status) return <span className="text-ink-3">–</span>;
  const rate = status.checks > 0 ? status.mentions / status.checks : 0;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {status.latest_mentioned ? (
        <Check aria-hidden="true" className="size-3.5 text-good-text" strokeWidth={3} />
      ) : (
        <Minus aria-hidden="true" className="size-3.5 text-ink-3" />
      )}
      <span className="sr-only">
        {status.latest_mentioned
          ? "Mentioned in the latest answer"
          : "Not mentioned in the latest answer"}
        {status.latest_cited ? ", cited" : ""}.
      </span>
      <span className="num text-xs text-ink-2">{formatPercent(rate, 0)}</span>
      {status.latest_cited ? (
        <Link2 aria-hidden="true" className="size-3 text-accent-text" />
      ) : null}
    </span>
  );
}

function topCompetitor(row: PromptRow): string | null {
  const entries = Object.entries(row.competitors);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  const [name, count] = entries[0] ?? ["", 0];
  return `${name} (${formatPercent(count / row.checks, 0)})`;
}

export default async function AiVisibilityPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const state = parseAiPageState(await searchParams);
  const anchor = await getDataAnchor();
  const periods = resolvePeriods(state, anchor);
  const filters = { engine: state.engine, topic: state.topic };

  const [summary, prompts, topics, detail] = await Promise.all([
    getAiSummary(filters, periods),
    listPrompts(filters, periods.current),
    listTopics(),
    state.prompt ? getPromptDetail(state.prompt, filters, periods.current) : null,
  ]);
  const gaps = prompts.filter((row) => row.is_gap);
  const shownPrompts = state.show === "gaps" ? gaps : prompts;
  const engines = (state.engine.length > 0 ? state.engine : [...ENGINES]) as Engine[];
  const activeEngines = ENGINES.filter((engine) => engines.includes(engine));
  const promptHref = (id: number) =>
    `/reports/ai-visibility?${aiStateToParams({ ...state, prompt: id })}`;

  const stats = [
    {
      label: "Visibility score",
      value: formatPosition(summary.score),
      delta: <DeltaLabel current={summary.score} previous={summary.score_prev} format="score" />,
    },
    {
      label: "Mention rate",
      value: formatPercent(summary.mention_rate, 1),
      delta: (
        <DeltaLabel
          current={summary.mention_rate}
          previous={summary.mention_rate_prev}
          format="percent"
        />
      ),
    },
    {
      label: "Citation rate",
      value: formatPercent(summary.citation_rate, 1),
      delta: (
        <DeltaLabel
          current={summary.citation_rate}
          previous={summary.citation_rate_prev}
          format="percent"
        />
      ),
    },
    {
      label: "Positive tone when mentioned",
      value: formatPercent(summary.positive_rate, 0),
      delta: null,
    },
  ];

  return (
    <FilterScope>
      <PageHeader
        title="AI visibility"
        description={`How often answer engines name and cite the brand for ${formatInteger(prompts.length)} tracked prompts. ${formatDateRange(periods.current.from, periods.current.to)}.`}
      />
      <div className="mb-3">
        <AiFilterBar state={state} resolved={periods.current} maxDate={anchor} topics={topics} />
      </div>

      {summary.checks === 0 ? (
        <Panel>
          <EmptyState title="No answers in this range">
            Widen the date range or clear the engine and topic filters. Answers are collected by the
            AI visibility pipeline.
          </EmptyState>
        </Panel>
      ) : (
        <PendingRegion className="flex flex-col gap-4">
          <Panel aria-label="Summary">
            <dl className="grid grid-cols-2 lg:grid-cols-4">
              {stats.map((stat, index) => (
                <div
                  key={stat.label}
                  className={[
                    "border-line px-4 py-3",
                    index % 2 === 1 ? "border-l" : "",
                    index >= 2 ? "border-t lg:border-t-0" : "",
                    index === 2 ? "lg:border-l" : "",
                  ].join(" ")}
                >
                  <dt className="text-sm text-ink-2">{stat.label}</dt>
                  <dd className="mt-0.5 flex items-baseline justify-between gap-3">
                    <span className="narrow text-2xl leading-8 font-semibold">{stat.value}</span>
                    {summary.compare && stat.delta ? (
                      <span className="text-sm">{stat.delta}</span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <AiTrend trend={summary.trend} engines={activeEngines} />
            <ScoreDefinition />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <EngineRates engines={summary.by_engine} />
            <Panel aria-labelledby="share-of-voice">
              <PanelHeader
                id="share-of-voice"
                title="Share of voice"
                description="Each tracked brand's share of all brand mentions in these answers."
              />
              <div className="px-4 pb-4">
                <BarList
                  ariaLabel="Share of voice by brand"
                  emphasis
                  rows={summary.share_of_voice.map((row) => ({
                    key: row.name,
                    label: row.is_brand ? `${row.name} (this brand)` : row.name,
                    value: row.share,
                    display: formatPercent(row.share, 0),
                    note: `named in ${formatPercent(row.answer_rate, 0)} of answers`,
                    emphasized: row.is_brand,
                  }))}
                />
              </div>
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Panel className="min-w-0 overflow-hidden" aria-labelledby="prompt-table">
              <PanelHeader
                id="prompt-table"
                title={state.show === "gaps" ? "Prompts with a visibility gap" : "Tracked prompts"}
                description={
                  <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>Per engine: mention rate over the range.</span>
                    <span className="inline-flex items-center gap-1">
                      <Check
                        aria-hidden="true"
                        className="size-3.5 text-good-text"
                        strokeWidth={3}
                      />
                      named in the latest answer
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Link2 aria-hidden="true" className="size-3 text-accent-text" />
                      cited
                    </span>
                  </span>
                }
              />
              {shownPrompts.length === 0 ? (
                <EmptyState title="No prompts to show">
                  No tracked prompt meets the gap definition for this range and these filters.
                </EmptyState>
              ) : (
                <TableWrap>
                  <Table>
                    <thead>
                      <tr>
                        <Th>Prompt</Th>
                        <Th align="right">Mention rate</Th>
                        {activeEngines.map((engine) => (
                          <Th key={engine}>
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                aria-hidden="true"
                                className="size-2 rounded-full"
                                style={{ backgroundColor: ENGINE_COLORS[engine] }}
                              />
                              {ENGINE_LABELS[engine]}
                            </span>
                          </Th>
                        ))}
                        <Th>Most-named competitor</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownPrompts.map((row) => (
                        <tr key={row.prompt_id} className="hover:bg-surface-2">
                          <Td className="min-w-64">
                            <Link
                              href={promptHref(row.prompt_id)}
                              scroll={false}
                              className="font-medium hover:text-accent-text hover:underline"
                            >
                              {row.prompt}
                            </Link>
                            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
                              {row.topic}
                              {row.is_gap ? <Badge tone="warning">Gap</Badge> : null}
                            </span>
                          </Td>
                          <Td align="right" className="font-semibold">
                            {formatPercent(row.mention_rate, 0)}
                          </Td>
                          {activeEngines.map((engine) => (
                            <Td key={engine}>
                              <EngineCell status={row.engines[engine]} />
                            </Td>
                          ))}
                          <Td className="whitespace-nowrap text-ink-2">
                            {topCompetitor(row) ?? "–"}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              )}
            </Panel>

            <Panel aria-labelledby="gap-list" className="self-start">
              <PanelHeader
                id="gap-list"
                title={`Gaps (${gaps.length})`}
                description={`Competitors named in at least ${formatPercent(GAP_THRESHOLDS.minCompetitorRate, 0)} of answers, the brand in at most ${formatPercent(GAP_THRESHOLDS.maxBrandRate, 0)}.`}
              />
              {gaps.length === 0 ? (
                <p className="px-4 pb-4 text-sm text-ink-3">No gaps in this range.</p>
              ) : (
                <ul className="px-4 pb-3">
                  {gaps.map((row) => (
                    <li
                      key={row.prompt_id}
                      className="border-b border-line py-2 text-sm last:border-b-0"
                    >
                      <Link
                        href={promptHref(row.prompt_id)}
                        scroll={false}
                        className="font-medium hover:text-accent-text hover:underline"
                      >
                        {row.prompt}
                      </Link>
                      <p className="num mt-0.5 text-xs text-ink-3">
                        Brand {formatPercent(row.mention_rate, 0)}, competitors{" "}
                        {formatPercent(row.competitor_rate, 0)}
                        {topCompetitor(row) ? `, led by ${topCompetitor(row)}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </PendingRegion>
      )}
      {detail ? <PromptDetailPanel detail={detail} state={state} /> : null}
    </FilterScope>
  );
}
