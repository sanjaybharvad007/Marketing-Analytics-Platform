import Link from "next/link";
import { FilterChips } from "@/components/seo/filter-chips";
import { KeywordTrend } from "@/components/seo/keyword-trend";
import { SeoFilterBar } from "@/components/seo/seo-filter-bar";
import { seoHref } from "@/components/seo/seo-state";
import { SeoTrend } from "@/components/seo/seo-trend";
import { KeywordsTable, PagesTable, QueriesTable } from "@/components/seo/tables";
import { FilterScope, PendingRegion } from "@/components/shell/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { DeltaLabel } from "@/components/ui/delta";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { resolvePeriods } from "@/lib/dates";
import { describeSeoFilters } from "@/lib/filters/chips";
import type { RawParams } from "@/lib/filters/params";
import { parseSeoPageState, SEO_TABS, type SeoPageState, type SeoTab } from "@/lib/filters/seo";
import {
  formatCompact,
  formatDateRange,
  formatInteger,
  formatPercent,
  formatPosition,
} from "@/lib/format";
import { getDataAnchor } from "@/lib/services/meta";
import {
  type DomainMetric,
  getDomainMetrics,
  getKeywordTrend,
  getPage,
  getSearchTrend,
  listCountries,
  listKeywords,
  listPages,
  listQueries,
  listSections,
  type SearchTrend,
} from "@/lib/services/seo";
import { listViews } from "@/lib/services/views";

export const dynamic = "force-dynamic";
export const metadata = { title: "SEO report" };

const TAB_LABELS: Record<SeoTab, string> = {
  queries: "Queries",
  pages: "Pages",
  keywords: "Keywords",
};

function Tabs({ state }: { state: SeoPageState }) {
  return (
    <nav aria-label="Report views" className="flex gap-1 border-b border-line px-3">
      {SEO_TABS.map((tab) => {
        const active = state.tab === tab;
        return (
          <Link
            key={tab}
            href={seoHref(state, { tab, page: 1, sort: undefined })}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "narrow -mb-px border-b-2 px-3 py-2.5 text-base",
              active
                ? "border-accent font-semibold text-ink"
                : "border-transparent text-ink-2 hover:text-ink",
            )}
          >
            {TAB_LABELS[tab]}
          </Link>
        );
      })}
    </nav>
  );
}

function Totals({ trend }: { trend: SearchTrend }) {
  const { totals, previousTotals: previous } = trend;
  const cells = [
    {
      label: "Clicks",
      value: formatCompact(totals.clicks),
      delta: <DeltaLabel current={totals.clicks} previous={previous?.clicks} />,
    },
    {
      label: "Impressions",
      value: formatCompact(totals.impressions),
      delta: <DeltaLabel current={totals.impressions} previous={previous?.impressions} />,
    },
    {
      label: "CTR",
      value: formatPercent(totals.ctr, 2),
      delta: <DeltaLabel current={totals.ctr} previous={previous?.ctr} format="percent" />,
    },
    {
      label: "Average position",
      value: formatPosition(totals.position),
      delta: (
        <DeltaLabel
          current={totals.position}
          previous={previous?.position}
          format="position"
          higherIsBetter={false}
        />
      ),
    },
  ];
  return (
    <Panel aria-label="Totals for the current filters">
      <dl className="grid h-full grid-cols-2 lg:grid-cols-1 lg:grid-rows-4">
        {cells.map((cell, index) => (
          <div
            key={cell.label}
            className={cn(
              "flex flex-col justify-center gap-0.5 border-line px-4 py-3",
              index % 2 === 1 && "border-l lg:border-l-0",
              index >= 2 && "border-t",
              index === 1 && "lg:border-t",
            )}
          >
            <dt className="text-sm text-ink-2">{cell.label}</dt>
            <dd className="flex items-baseline justify-between gap-3">
              <span className="narrow text-xl leading-7 font-semibold">{cell.value}</span>
              {previous ? <span className="text-sm">{cell.delta}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function DomainAuthority({
  domains,
  brandDomain,
}: {
  domains: DomainMetric[];
  brandDomain?: string;
}) {
  if (domains.length === 0) return null;
  return (
    <Panel aria-label="Domain authority">
      <table className="w-full table-fixed text-sm">
        <caption className="narrow px-4 pt-3.5 pb-2 text-left text-base font-semibold">
          Domain authority
        </caption>
        <thead>
          <tr className="text-xs text-ink-3">
            <th scope="col" className="px-4 pb-1 text-left font-medium">
              Domain
            </th>
            <th scope="col" className="w-24 px-4 pb-1 text-right font-medium">
              Score
            </th>
          </tr>
        </thead>
        <tbody>
          {domains.map((domain) => {
            const own = domain.is_own || domain.domain === brandDomain;
            return (
              <tr key={domain.domain} className="border-t border-line align-top">
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  <span
                    className={cn("block truncate", own && "font-semibold")}
                    title={domain.domain}
                  >
                    {domain.domain.replace(/^www\./, "")}
                  </span>
                  <span className="num block truncate text-xs text-ink-3">
                    {formatInteger(domain.referring_domains)} referring domains
                  </span>
                  {own ? <span className="block text-xs text-accent-text">This site</span> : null}
                </th>
                <td className="num px-4 py-2 text-right whitespace-nowrap">
                  <span className="block font-semibold">{domain.authority_score}</span>
                  {domain.authority_change ? (
                    <DeltaLabel
                      current={domain.authority_score}
                      previous={domain.authority_score - domain.authority_change}
                      format="score"
                      className="text-xs"
                    />
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

export default async function SeoReportPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const state = parseSeoPageState(await searchParams);
  const anchor = await getDataAnchor();
  const periods = resolvePeriods(state, anchor);
  const compared = periods.previous !== null;

  const [countries, sections, views, drillPage] = await Promise.all([
    listCountries(),
    listSections(),
    listViews("seo"),
    state.page_id ? getPage(state.page_id) : null,
  ]);
  const chips = describeSeoFilters(state, { pageLabel: drillPage?.path });

  let table: React.ReactNode;
  let chart: React.ReactNode;
  let side: React.ReactNode;
  if (state.tab === "keywords") {
    const [result, trend, domains] = await Promise.all([
      listKeywords(state, periods),
      getKeywordTrend(state, periods.current),
      getDomainMetrics(periods.current),
    ]);
    table = <KeywordsTable state={state} result={result} compared={compared} />;
    chart = <KeywordTrend points={trend} />;
    side = <DomainAuthority domains={domains} />;
  } else if (state.tab === "pages") {
    const [result, trend] = await Promise.all([
      listPages(state, periods),
      getSearchTrend(state, periods, "page"),
    ]);
    table = <PagesTable state={state} result={result} compared={compared} />;
    chart = <SeoTrend trend={trend} initialMetric={state.metric} />;
    side = <Totals trend={trend} />;
  } else {
    const [result, trend] = await Promise.all([
      listQueries(state, periods),
      getSearchTrend(state, periods, "query"),
    ]);
    table = <QueriesTable state={state} result={result} compared={compared} />;
    chart = <SeoTrend trend={trend} initialMetric={state.metric} />;
    side = <Totals trend={trend} />;
  }

  return (
    <FilterScope>
      <PageHeader
        title="SEO report"
        description={
          periods.previous
            ? `${formatDateRange(periods.current.from, periods.current.to)}, compared with ${formatDateRange(periods.previous.from, periods.previous.to)}`
            : formatDateRange(periods.current.from, periods.current.to)
        }
      />
      <div className="mb-3 flex flex-col gap-2.5">
        <SeoFilterBar
          state={state}
          resolved={periods.current}
          maxDate={anchor}
          countries={countries}
          sections={sections}
          views={views}
        />
        <FilterChips state={state} chips={chips} />
        {state.tab === "keywords" &&
        (state.country.length > 0 || state.device.length > 0 || state.brand !== "all") ? (
          <p className="text-sm text-ink-3">
            Country, device and brand filters apply to Search Console data and are ignored for
            tracked keywords.
          </p>
        ) : null}
      </div>

      <PendingRegion className="flex flex-col gap-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
          {chart}
          {side}
        </div>
        <Panel className="overflow-hidden">
          <Tabs state={state} />
          {table}
        </Panel>
      </PendingRegion>
    </FilterScope>
  );
}
