import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { DeltaLabel } from "@/components/ui/delta";
import { EmptyState } from "@/components/ui/panel";
import { Pagination, Table, TableWrap, Td, Th } from "@/components/ui/table";
import { humanize } from "@/lib/domain";
import type { SeoPageState } from "@/lib/filters/seo";
import { formatInteger, formatPercent, formatPosition } from "@/lib/format";
import type { KeywordRow, PageRow, Paged, QueryRow, SearchMetrics } from "@/lib/services/seo";
import { seoHref, sortHref, sortState } from "./seo-state";

interface TableProps<Row> {
  state: SeoPageState;
  result: Paged<Row>;
  compared: boolean;
}

function sortProps(state: SeoPageState, active: string, key: string) {
  return { href: sortHref(state, active, key), active: sortState(state, active, key) };
}

function NoRows() {
  return (
    <EmptyState title="Nothing matches these filters">
      Widen the date range or remove a filter. Use Clear all above to start over.
    </EmptyState>
  );
}

/** A metric with its change versus the comparison period beside it. */
function MetricCell({ value, delta }: { value: string; delta: ReactNode }) {
  return (
    <Td align="right" className="whitespace-nowrap">
      <span className="inline-flex items-center justify-end gap-2">
        <span>{value}</span>
        {delta ? (
          <span className="inline-block w-[4.75rem] text-right text-xs">{delta}</span>
        ) : null}
      </span>
    </Td>
  );
}

function MetricCells({ row, compared }: { row: SearchMetrics; compared: boolean }) {
  return (
    <>
      <MetricCell
        value={formatInteger(row.clicks)}
        delta={
          compared ? <DeltaLabel current={row.clicks} previous={row.clicks_prev ?? 0} /> : null
        }
      />
      <MetricCell
        value={formatInteger(row.impressions)}
        delta={
          compared ? (
            <DeltaLabel current={row.impressions} previous={row.impressions_prev ?? 0} />
          ) : null
        }
      />
      <MetricCell
        value={formatPercent(row.ctr, 2)}
        delta={
          compared ? (
            <DeltaLabel current={row.ctr} previous={row.ctr_prev} format="percent" />
          ) : null
        }
      />
      <MetricCell
        value={formatPosition(row.position)}
        delta={
          compared ? (
            <DeltaLabel
              current={row.position}
              previous={row.position_prev}
              format="position"
              higherIsBetter={false}
            />
          ) : null
        }
      />
    </>
  );
}

function MetricHeaders({ state, active }: { state: SeoPageState; active: string }) {
  return (
    <>
      <Th align="right" sort={sortProps(state, active, "clicks")}>
        Clicks
      </Th>
      <Th align="right" sort={sortProps(state, active, "impressions")}>
        Impressions
      </Th>
      <Th align="right" sort={sortProps(state, active, "ctr")}>
        CTR
      </Th>
      <Th align="right" sort={sortProps(state, active, "position")}>
        Avg. position
      </Th>
    </>
  );
}

function Footer({ state, total }: { state: SeoPageState; total: number }) {
  return (
    <Pagination
      page={state.page}
      pageSize={state.page_size}
      total={total}
      hrefFor={(page) => seoHref(state, { page })}
    />
  );
}

export function QueriesTable({ state, result, compared }: TableProps<QueryRow>) {
  if (result.rows.length === 0) return <NoRows />;
  return (
    <>
      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th sort={sortProps(state, result.sort, "query")}>Query</Th>
              <MetricHeaders state={state} active={result.sort} />
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.query} className="hover:bg-surface-2">
                <Td className="w-full max-w-0 min-w-56">
                  <Link
                    href={seoHref(state, {
                      tab: "pages",
                      query: row.query,
                      page: 1,
                      sort: undefined,
                    })}
                    title="Show the pages that rank for this query"
                    className="block truncate font-medium text-ink hover:text-accent-text hover:underline"
                  >
                    {row.query}
                  </Link>
                </Td>
                <MetricCells row={row} compared={compared} />
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
      <Footer state={state} total={result.total} />
    </>
  );
}

export function PagesTable({ state, result, compared }: TableProps<PageRow>) {
  if (result.rows.length === 0) return <NoRows />;
  return (
    <>
      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th sort={sortProps(state, result.sort, "path")}>Page</Th>
              <Th sort={sortProps(state, result.sort, "section")}>Section</Th>
              <MetricHeaders state={state} active={result.sort} />
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.page_id} className="hover:bg-surface-2">
                <Td className="w-full max-w-0 min-w-56">
                  <Link
                    href={seoHref(state, {
                      tab: "queries",
                      page_id: row.page_id,
                      query: undefined,
                      page: 1,
                      sort: undefined,
                    })}
                    title="Show the queries this page ranks for"
                    className="block min-w-0 hover:text-accent-text"
                  >
                    <span className="block truncate font-medium text-ink hover:underline">
                      {row.title ?? row.path}
                    </span>
                    <span className="block truncate text-xs text-ink-3">{row.path}</span>
                  </Link>
                </Td>
                <Td className="whitespace-nowrap text-ink-2">{humanize(row.section)}</Td>
                <MetricCells row={row} compared={compared} />
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
      <Footer state={state} total={result.total} />
    </>
  );
}

function RankChange({ change }: { change: number | null }) {
  if (change === null) return <span className="text-ink-3">–</span>;
  if (change === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-ink-3">
        <Minus aria-hidden="true" className="size-3.5" />0
        <span className="sr-only"> (no change)</span>
      </span>
    );
  }
  const improved = change > 0;
  const Icon = improved ? ArrowUp : ArrowDown;
  return (
    <span
      className={`inline-flex items-center gap-0.5 ${improved ? "text-good-text" : "text-bad-text"}`}
    >
      <Icon aria-hidden="true" className="size-3.5" strokeWidth={2.25} />
      {Math.abs(change)}
      <span className="sr-only">{improved ? " positions gained" : " positions lost"}</span>
    </span>
  );
}

export function KeywordsTable({ state, result, compared }: TableProps<KeywordRow>) {
  if (result.rows.length === 0) return <NoRows />;
  return (
    <>
      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th sort={sortProps(state, result.sort, "keyword")}>Keyword</Th>
              <Th align="right" sort={sortProps(state, result.sort, "position")}>
                Position
              </Th>
              {compared ? (
                <Th align="right" sort={sortProps(state, result.sort, "change")}>
                  Change
                </Th>
              ) : null}
              <Th align="right" sort={sortProps(state, result.sort, "search_volume")}>
                Volume
              </Th>
              <Th align="right" sort={sortProps(state, result.sort, "difficulty")}>
                Difficulty
              </Th>
              <Th align="right" sort={sortProps(state, result.sort, "cpc")}>
                CPC
              </Th>
              <Th>Intent</Th>
              <Th>Ranking page</Th>
              <Th>SERP features</Th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.keyword_id} className="hover:bg-surface-2">
                <Td className="font-medium whitespace-nowrap">
                  <Link
                    href={seoHref(state, {
                      tab: "queries",
                      query: row.keyword,
                      page: 1,
                      sort: undefined,
                    })}
                    title="Show Search Console data for this keyword"
                    className="hover:text-accent-text hover:underline"
                  >
                    {row.keyword}
                  </Link>
                </Td>
                <Td align="right" className="font-semibold">
                  {row.position ?? "–"}
                </Td>
                {compared ? (
                  <Td align="right">
                    <RankChange change={row.change} />
                  </Td>
                ) : null}
                <Td align="right">{formatInteger(row.search_volume)}</Td>
                <Td align="right">{row.difficulty ?? "–"}</Td>
                <Td align="right">{row.cpc === null ? "–" : `$${row.cpc.toFixed(2)}`}</Td>
                <Td className="whitespace-nowrap text-ink-2">{humanize(row.intent)}</Td>
                <Td className="max-w-56">
                  {row.path ? (
                    <span className="block truncate text-ink-2" title={row.path}>
                      {row.path}
                    </span>
                  ) : (
                    <span className="text-ink-3">Not ranking</span>
                  )}
                </Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    {row.serp_features.map((feature) => (
                      <Badge key={feature}>{humanize(feature)}</Badge>
                    ))}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
      <Footer state={state} total={result.total} />
    </>
  );
}
