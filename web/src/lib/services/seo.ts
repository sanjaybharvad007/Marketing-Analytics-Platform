/**
 * SEO report queries: search queries, pages, tracked keywords, their trend
 * series and the candidate lists behind `map opportunities`.
 */
import { type SQL, sql } from "drizzle-orm";
import { queryRows } from "@/db/client";
import { type DateRange, eachDay, type ResolvedPeriods } from "@/lib/dates";
import type { Intent, PageType } from "@/lib/domain";
import { containsPattern } from "@/lib/filters/params";
import type { SeoFilters } from "@/lib/filters/seo";
import {
  andAll,
  needsPageJoin,
  needsQueryDimension,
  orderBy,
  pageConditions,
  positionCondition,
  searchHavingConditions,
  searchRowConditions,
} from "@/lib/filters/sql";

export interface Paged<Row> {
  rows: Row[];
  total: number;
  sort: string;
}

export interface SearchMetrics {
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
  clicks_prev: number | null;
  impressions_prev: number | null;
  ctr_prev: number | null;
  position_prev: number | null;
  clicks_delta: number | null;
  impressions_delta: number | null;
}

export interface QueryRow extends SearchMetrics {
  query: string;
}

export interface PageRow extends SearchMetrics {
  page_id: number;
  url: string;
  path: string;
  title: string | null;
  section: string;
  page_type: PageType;
}

const PAGES_JOIN = sql`JOIN pages p ON p.id = s.page_id`;

/** gsc_daily when a filter needs the query text, otherwise the page-level rollup. */
function searchSource(filters: SeoFilters, forceQueryLevel: boolean): SQL {
  return forceQueryLevel || needsQueryDimension(filters)
    ? sql`gsc_daily`
    : sql`mv_search_page_daily`;
}

const AGGREGATES = sql`
  sum(s.clicks)::float8 AS clicks,
  sum(s.impressions)::float8 AS impressions,
  sum(s.sum_position)::float8 AS sum_position`;

/** An empty `prev` CTE with the right column types, used when there is no comparison. */
function noPrevious(keyType: SQL): SQL {
  return sql`
    SELECT NULL::${keyType} AS key, NULL::float8 AS clicks, NULL::float8 AS impressions,
           NULL::float8 AS sum_position
    WHERE FALSE`;
}

const METRIC_COLUMNS = sql`
  cur.clicks,
  cur.impressions,
  cur.clicks / NULLIF(cur.impressions, 0) AS ctr,
  cur.sum_position / NULLIF(cur.impressions, 0) AS position,
  prev.clicks AS clicks_prev,
  prev.impressions AS impressions_prev,
  prev.clicks / NULLIF(prev.impressions, 0) AS ctr_prev,
  prev.sum_position / NULLIF(prev.impressions, 0) AS position_prev`;

function deltaColumns(compare: boolean): SQL {
  return compare
    ? sql`cur.clicks - COALESCE(prev.clicks, 0) AS clicks_delta,
          cur.impressions - COALESCE(prev.impressions, 0) AS impressions_delta`
    : sql`NULL::float8 AS clicks_delta, NULL::float8 AS impressions_delta`;
}

const METRIC_SORTS = {
  clicks: sql`cur.clicks`,
  impressions: sql`cur.impressions`,
  ctr: sql`ctr`,
  position: sql`position`,
  clicks_delta: sql`clicks_delta`,
  impressions_delta: sql`impressions_delta`,
} as const;

interface GroupedQuery {
  current: SQL;
  previous: SQL;
}

/** The `cur` and `prev` CTE bodies: one row per group key with summed metrics. */
function groupedPeriods(
  filters: SeoFilters,
  periods: ResolvedPeriods,
  key: SQL,
  keyType: SQL,
  source: SQL,
  joinPages: boolean,
): GroupedQuery {
  const join = joinPages ? PAGES_JOIN : sql``;
  const having = searchHavingConditions(filters);
  const current = sql`
    SELECT ${key} AS key, ${AGGREGATES}
    FROM ${source} s ${join}
    WHERE ${andAll(searchRowConditions(filters, periods.current))}
    GROUP BY ${key}
    ${having.length > 0 ? sql`HAVING ${andAll(having)}` : sql``}`;
  const previous = periods.previous
    ? sql`
    SELECT ${key} AS key, ${AGGREGATES}
    FROM ${source} s ${join}
    WHERE ${andAll(searchRowConditions(filters, periods.previous))}
    GROUP BY ${key}`
    : noPrevious(keyType);
  return { current, previous };
}

function limitOffset(filters: Pick<SeoFilters, "page" | "page_size">): SQL {
  return sql`LIMIT ${filters.page_size} OFFSET ${(filters.page - 1) * filters.page_size}`;
}

export async function listQueries(
  filters: SeoFilters,
  periods: ResolvedPeriods,
): Promise<Paged<QueryRow>> {
  const { current, previous } = groupedPeriods(
    filters,
    periods,
    sql`s.query`,
    sql`text`,
    sql`gsc_daily`,
    needsPageJoin(filters),
  );
  const order = orderBy(
    { ...METRIC_SORTS, query: sql`cur.key` },
    filters.sort,
    filters.dir,
    "clicks",
  );
  const rows = await queryRows<QueryRow & { total: number }>(sql`
    WITH cur AS (${current}), prev AS (${previous})
    SELECT cur.key AS query, ${METRIC_COLUMNS}, ${deltaColumns(periods.previous !== null)},
           (count(*) OVER ())::int AS total
    FROM cur
    LEFT JOIN prev ON prev.key = cur.key
    ORDER BY ${order.clause}, cur.key
    ${limitOffset(filters)}
  `);
  return stripTotal(rows, order.key);
}

export async function listPages(
  filters: SeoFilters,
  periods: ResolvedPeriods,
): Promise<Paged<PageRow>> {
  const { current, previous } = groupedPeriods(
    filters,
    periods,
    sql`s.page_id`,
    sql`integer`,
    searchSource(filters, false),
    needsPageJoin(filters),
  );
  const order = orderBy(
    { ...METRIC_SORTS, path: sql`pg.path`, section: sql`pg.section` },
    filters.sort,
    filters.dir,
    "clicks",
  );
  const rows = await queryRows<PageRow & { total: number }>(sql`
    WITH cur AS (${current}), prev AS (${previous})
    SELECT pg.id AS page_id, pg.url, pg.path, pg.title, pg.section, pg.page_type,
           ${METRIC_COLUMNS}, ${deltaColumns(periods.previous !== null)},
           (count(*) OVER ())::int AS total
    FROM cur
    JOIN pages pg ON pg.id = cur.key
    LEFT JOIN prev ON prev.key = cur.key
    ORDER BY ${order.clause}, pg.path
    ${limitOffset(filters)}
  `);
  return stripTotal(rows, order.key);
}

/** Split the window-function row count off the rows. */
function stripTotal<R extends { total: number }>(
  rows: ReadonlyArray<R>,
  sort: string,
): Paged<Omit<R, "total">> {
  return {
    total: rows[0]?.total ?? 0,
    sort,
    rows: rows.map(({ total: _total, ...row }) => row),
  };
}

// --- trend ----------------------------------------------------------------------

export interface TrendPoint {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
}

export interface SearchTrend {
  series: TrendPoint[];
  /** Previous-period points aligned by index with `series`. */
  previousSeries: TrendPoint[] | null;
  totals: Omit<TrendPoint, "date">;
  previousTotals: Omit<TrendPoint, "date"> | null;
}

interface DayRow {
  date: string;
  clicks: number;
  impressions: number;
  sum_position: number;
}

function toPoints(range: DateRange, rows: ReadonlyArray<DayRow>): TrendPoint[] {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  return eachDay(range).map((date) => {
    const row = byDate.get(date);
    const impressions = row?.impressions ?? 0;
    return {
      date,
      clicks: row?.clicks ?? 0,
      impressions,
      ctr: impressions > 0 ? (row?.clicks ?? 0) / impressions : null,
      position: impressions > 0 ? (row?.sum_position ?? 0) / impressions : null,
    };
  });
}

function totalOf(range: DateRange, rows: ReadonlyArray<DayRow>): Omit<TrendPoint, "date"> {
  let clicks = 0;
  let impressions = 0;
  let sumPosition = 0;
  for (const row of rows) {
    if (row.date < range.from || row.date > range.to) continue;
    clicks += row.clicks;
    impressions += row.impressions;
    sumPosition += row.sum_position;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    position: impressions > 0 ? sumPosition / impressions : null,
  };
}

/**
 * Daily totals under the same filters as the table.
 *
 * When aggregate filters are active (position bucket, minimum clicks or
 * impressions) the series only counts the queries or pages that pass them in
 * the current period, so the chart and the table always describe the same set.
 */
export async function getSearchTrend(
  filters: SeoFilters,
  periods: ResolvedPeriods,
  groupBy: "query" | "page",
): Promise<SearchTrend> {
  const { current, previous } = periods;
  const span: DateRange = { from: previous?.from ?? current.from, to: current.to };
  const having = searchHavingConditions(filters);
  const queryLevel = groupBy === "query" && having.length > 0;
  const source = searchSource(filters, queryLevel);
  const join = needsPageJoin(filters) ? PAGES_JOIN : sql``;
  const key = groupBy === "query" ? sql`s.query` : sql`s.page_id`;

  const conditions = searchRowConditions(filters, span);
  if (having.length > 0) {
    conditions.push(sql`${key} IN (
      SELECT ${key}
      FROM ${source} s ${join}
      WHERE ${andAll(searchRowConditions(filters, current))}
      GROUP BY ${key}
      HAVING ${andAll(having)}
    )`);
  }

  const rows = await queryRows<DayRow>(sql`
    SELECT s.date::text AS date, ${AGGREGATES}
    FROM ${source} s ${join}
    WHERE ${andAll(conditions)}
    GROUP BY s.date
    ORDER BY s.date
  `);
  return {
    series: toPoints(current, rows),
    previousSeries: previous ? toPoints(previous, rows) : null,
    totals: totalOf(current, rows),
    previousTotals: previous ? totalOf(previous, rows) : null,
  };
}

// --- tracked keywords -------------------------------------------------------------

export interface KeywordRow {
  keyword_id: number;
  keyword: string;
  search_volume: number;
  difficulty: number | null;
  intent: Intent;
  cpc: number | null;
  position: number | null;
  position_prev: number | null;
  /** Positions gained (positive) or lost (negative) versus the comparison date. */
  change: number | null;
  page_id: number | null;
  url: string | null;
  path: string | null;
  serp_features: string[];
  snapshot_date: string;
}

type KeywordFilters = Pick<
  SeoFilters,
  "q" | "q_not" | "url" | "section" | "page_type" | "position" | "page_id" | "query"
>;

function keywordConditions(filters: KeywordFilters): SQL[] {
  const conditions: SQL[] = [];
  if (filters.q) conditions.push(sql`k.keyword ILIKE ${containsPattern(filters.q)}`);
  if (filters.q_not) conditions.push(sql`k.keyword NOT ILIKE ${containsPattern(filters.q_not)}`);
  if (filters.query) conditions.push(sql`k.keyword = ${filters.query}`);
  if (filters.page_id) conditions.push(sql`r.page_id = ${filters.page_id}`);
  conditions.push(...pageConditions(filters));
  return conditions;
}

/**
 * Tracked keywords with their position on the newest snapshot inside the
 * range, compared with the newest snapshot of the previous period.
 */
export async function listKeywords(
  filters: SeoFilters,
  periods: ResolvedPeriods,
): Promise<Paged<KeywordRow>> {
  const { current, previous } = periods;
  const conditions = keywordConditions(filters);
  const bucket = positionCondition(sql`r.position`, filters.position);
  if (bucket) conditions.push(bucket);

  const order = orderBy(
    {
      keyword: sql`k.keyword`,
      search_volume: sql`k.search_volume`,
      difficulty: sql`k.difficulty`,
      cpc: sql`k.cpc`,
      position: sql`r.position`,
      change: sql`change`,
    },
    filters.sort,
    filters.dir,
    "search_volume",
  );
  const previousSnapshot = previous
    ? sql`(SELECT max(date) FROM keyword_rankings WHERE date BETWEEN ${previous.from} AND ${previous.to})`
    : sql`NULL::date`;

  const rows = await queryRows<KeywordRow & { total: number }>(sql`
    WITH snapshot AS (
      SELECT max(date) AS day FROM keyword_rankings
      WHERE date BETWEEN ${current.from} AND ${current.to}
    )
    SELECT k.id AS keyword_id, k.keyword, k.search_volume, k.difficulty::int AS difficulty,
           k.intent, k.cpc::float8 AS cpc,
           r.position::int AS position, pr.position::int AS position_prev,
           (pr.position - r.position)::int AS change,
           p.id AS page_id, p.url, p.path, r.serp_features, r.date::text AS snapshot_date,
           (count(*) OVER ())::int AS total
    FROM keyword_rankings r
    JOIN snapshot ON r.date = snapshot.day
    JOIN keywords k ON k.id = r.keyword_id
    LEFT JOIN pages p ON p.id = r.page_id
    LEFT JOIN keyword_rankings pr ON pr.keyword_id = r.keyword_id AND pr.date = ${previousSnapshot}
    WHERE ${andAll(conditions)}
    ORDER BY ${order.clause}, k.keyword
    ${limitOffset(filters)}
  `);
  return stripTotal(rows, order.key);
}

export interface KeywordTrendPoint {
  date: string;
  top3: number;
  top10: number;
  top20: number;
  tracked: number;
}

/** Daily count of tracked keywords ranking in the top 3, 10 and 20. */
export async function getKeywordTrend(
  filters: SeoFilters,
  range: DateRange,
): Promise<KeywordTrendPoint[]> {
  const conditions = [
    sql`r.date BETWEEN ${range.from} AND ${range.to}`,
    ...keywordConditions(filters),
  ];
  const rows = await queryRows<KeywordTrendPoint>(sql`
    SELECT r.date::text AS date,
           (count(*) FILTER (WHERE r.position <= 3))::int AS top3,
           (count(*) FILTER (WHERE r.position <= 10))::int AS top10,
           (count(*) FILTER (WHERE r.position <= 20))::int AS top20,
           count(*)::int AS tracked
    FROM keyword_rankings r
    JOIN keywords k ON k.id = r.keyword_id
    LEFT JOIN pages p ON p.id = r.page_id
    WHERE ${andAll(conditions)}
    GROUP BY r.date
    ORDER BY r.date
  `);
  return rows;
}

export interface DomainMetric {
  domain: string;
  is_own: boolean;
  authority_score: number;
  authority_change: number | null;
  referring_domains: number;
  backlinks: number;
}

/** Latest authority metrics for the brand and competitors, with change over the range. */
export async function getDomainMetrics(range: DateRange): Promise<DomainMetric[]> {
  const rows = await queryRows<DomainMetric>(sql`
    SELECT DISTINCT ON (d.domain)
           d.domain, d.is_own, d.authority_score::int AS authority_score,
           (d.authority_score - first.authority_score)::int AS authority_change,
           d.referring_domains, d.backlinks
    FROM domain_metrics_daily d
    LEFT JOIN LATERAL (
      SELECT authority_score FROM domain_metrics_daily f
      WHERE f.domain = d.domain AND f.date >= ${range.from}
      ORDER BY f.date LIMIT 1
    ) first ON TRUE
    WHERE d.date <= ${range.to}
    ORDER BY d.domain, d.date DESC
  `);
  return [...rows].sort(
    (a, b) => Number(b.is_own) - Number(a.is_own) || b.authority_score - a.authority_score,
  );
}

// --- opportunity candidates ---------------------------------------------------------

export interface StrikingDistanceRow {
  query: string;
  page_id: number;
  url: string;
  path: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface StrikingDistanceOptions {
  positionMin: number;
  positionMax: number;
  minImpressions: number;
  limit: number;
}

/**
 * Non-brand queries whose average position sits in a band (by default 8-20)
 * with at least `minImpressions`, attributed to the page that receives most
 * of their impressions.
 */
export async function listStrikingDistance(
  range: DateRange,
  options: StrikingDistanceOptions,
): Promise<StrikingDistanceRow[]> {
  const rows = await queryRows<StrikingDistanceRow>(sql`
    WITH per_page AS (
      SELECT s.query, s.page_id, sum(s.clicks) AS clicks, sum(s.impressions) AS impressions,
             sum(s.sum_position) AS sum_position
      FROM gsc_daily s
      WHERE s.date BETWEEN ${range.from} AND ${range.to} AND NOT s.is_brand
      GROUP BY s.query, s.page_id
    ), per_query AS (
      SELECT query,
             sum(clicks)::float8 AS clicks,
             sum(impressions)::float8 AS impressions,
             (sum(sum_position) / NULLIF(sum(impressions), 0))::float8 AS position,
             (array_agg(page_id ORDER BY impressions DESC))[1] AS page_id
      FROM per_page
      GROUP BY query
    )
    SELECT q.query, q.page_id, p.url, p.path, q.clicks, q.impressions,
           q.clicks / NULLIF(q.impressions, 0) AS ctr, q.position
    FROM per_query q
    JOIN pages p ON p.id = q.page_id
    WHERE q.position BETWEEN ${options.positionMin} AND ${options.positionMax}
      AND q.impressions >= ${options.minImpressions}
    ORDER BY q.impressions DESC, q.query
    LIMIT ${options.limit}
  `);
  return rows;
}

export interface DecayingPageRow {
  page_id: number;
  url: string;
  path: string;
  title: string | null;
  clicks: number;
  clicks_prev: number;
  change: number;
  position: number | null;
  position_prev: number | null;
}

/** Pages with fewer organic clicks than in the previous period, largest loss first. */
export async function listDecayingPages(
  current: DateRange,
  previous: DateRange,
  limit: number,
): Promise<DecayingPageRow[]> {
  const rows = await queryRows<DecayingPageRow>(sql`
    WITH totals AS (
      SELECT s.page_id,
             COALESCE(sum(s.clicks) FILTER (WHERE s.date >= ${current.from}), 0)::float8 AS clicks,
             COALESCE(sum(s.clicks) FILTER (WHERE s.date <= ${previous.to}), 0)::float8 AS clicks_prev,
             (sum(s.sum_position) FILTER (WHERE s.date >= ${current.from})
               / NULLIF(sum(s.impressions) FILTER (WHERE s.date >= ${current.from}), 0))::float8 AS position,
             (sum(s.sum_position) FILTER (WHERE s.date <= ${previous.to})
               / NULLIF(sum(s.impressions) FILTER (WHERE s.date <= ${previous.to}), 0))::float8 AS position_prev
      FROM mv_search_page_daily s
      WHERE s.date BETWEEN ${previous.from} AND ${current.to}
      GROUP BY s.page_id
    )
    SELECT t.page_id, p.url, p.path, p.title, t.clicks, t.clicks_prev,
           (t.clicks - t.clicks_prev) / t.clicks_prev AS change,
           t.position, t.position_prev
    FROM totals t
    JOIN pages p ON p.id = t.page_id
    WHERE t.clicks_prev > 0 AND t.clicks < t.clicks_prev
    ORDER BY t.clicks_prev - t.clicks DESC
    LIMIT ${limit}
  `);
  return rows;
}

/** Sections that have search data, for the section filter. */
export async function listSections(): Promise<string[]> {
  const rows = await queryRows<{ section: string }>(
    sql`SELECT DISTINCT section FROM pages ORDER BY section`,
  );
  return rows.map((row) => row.section);
}

export interface PageLookup {
  id: number;
  url: string;
  path: string;
  title: string | null;
  section: string;
  page_type: PageType;
}

export async function getPage(id: number): Promise<PageLookup | null> {
  const [row] = await queryRows<PageLookup>(
    sql`SELECT id, url, path, title, section, page_type FROM pages WHERE id = ${id}`,
  );
  return row ?? null;
}

export async function listPageOptions(): Promise<PageLookup[]> {
  const rows = await queryRows<PageLookup>(
    sql`SELECT id, url, path, title, section, page_type FROM pages ORDER BY path`,
  );
  return rows;
}

/** Countries that appear in the search data, most clicks first, for the country filter. */
export async function listCountries(): Promise<string[]> {
  const rows = await queryRows<{ country: string }>(sql`
    SELECT country FROM mv_search_page_daily GROUP BY country ORDER BY sum(clicks) DESC
  `);
  return rows.map((row) => row.country.trim());
}
