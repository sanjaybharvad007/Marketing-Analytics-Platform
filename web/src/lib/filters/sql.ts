/**
 * Translate SEO filters into SQL conditions.
 *
 * Search facts are read through the alias `s` (gsc_daily or its page-level
 * rollup) and page attributes through `p`. Every user-supplied value is a
 * bound parameter; the only SQL text built here comes from literals in this
 * file.
 */
import { type SQL, sql } from "drizzle-orm";
import type { DateRange } from "@/lib/dates";
import { containsPattern } from "./params";
import { POSITION_BOUNDS, type PositionBucket, type SeoFilters } from "./seo";

export function inList(column: SQL, values: readonly (string | number)[]): SQL {
  return sql`${column} IN (${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`;
}

export function andAll(conditions: SQL[]): SQL {
  return conditions.length === 0 ? sql`TRUE` : sql.join(conditions, sql` AND `);
}

/** True when a filter can only be answered from the query-level table. */
export function needsQueryDimension(filters: Pick<SeoFilters, "q" | "q_not" | "query">): boolean {
  return Boolean(filters.q || filters.q_not || filters.query);
}

/** True when a filter refers to a page attribute and so needs the pages join. */
export function needsPageJoin(filters: Pick<SeoFilters, "section" | "page_type" | "url">): boolean {
  return filters.section.length > 0 || Boolean(filters.page_type) || Boolean(filters.url);
}

/** Row-level conditions: they restrict which fact rows are aggregated. */
export function searchRowConditions(filters: SeoFilters, range: DateRange): SQL[] {
  const conditions: SQL[] = [sql`s.date BETWEEN ${range.from} AND ${range.to}`];
  if (filters.country.length > 0) conditions.push(inList(sql`s.country`, filters.country));
  if (filters.device.length > 0) conditions.push(inList(sql`s.device`, filters.device));
  if (filters.brand === "brand") conditions.push(sql`s.is_brand`);
  if (filters.brand === "non_brand") conditions.push(sql`NOT s.is_brand`);
  if (filters.page_id) conditions.push(sql`s.page_id = ${filters.page_id}`);
  if (filters.q) conditions.push(sql`s.query ILIKE ${containsPattern(filters.q)}`);
  if (filters.q_not) conditions.push(sql`s.query NOT ILIKE ${containsPattern(filters.q_not)}`);
  if (filters.query) conditions.push(sql`s.query = ${filters.query}`);
  conditions.push(...pageConditions(filters));
  return conditions;
}

/** Conditions on page attributes (alias `p`). */
export function pageConditions(filters: Pick<SeoFilters, "section" | "page_type" | "url">): SQL[] {
  const conditions: SQL[] = [];
  if (filters.section.length > 0) conditions.push(inList(sql`p.section`, filters.section));
  if (filters.page_type) conditions.push(sql`p.page_type = ${filters.page_type}`);
  if (filters.url) conditions.push(sql`p.url ILIKE ${containsPattern(filters.url)}`);
  return conditions;
}

/** One position bucket as a condition on an average-position expression. */
export function positionBucketCondition(position: SQL, bucket: PositionBucket): SQL {
  const { above, upTo } = POSITION_BOUNDS[bucket];
  return upTo === null
    ? sql`${position} > ${above}`
    : sql`(${position} > ${above} AND ${position} <= ${upTo})`;
}

export function positionCondition(position: SQL, buckets: readonly PositionBucket[]): SQL | null {
  if (buckets.length === 0) return null;
  return sql`(${sql.join(
    buckets.map((bucket) => positionBucketCondition(position, bucket)),
    sql` OR `,
  )})`;
}

/**
 * Aggregate-level conditions (HAVING): they restrict which grouped queries or
 * pages are returned, based on their totals in the current period.
 */
export function searchHavingConditions(
  filters: Pick<SeoFilters, "position" | "min_impressions" | "min_clicks">,
): SQL[] {
  const conditions: SQL[] = [];
  const position = positionCondition(
    sql`sum(s.sum_position) / NULLIF(sum(s.impressions), 0)`,
    filters.position,
  );
  if (position) conditions.push(position);
  if (filters.min_impressions !== undefined) {
    conditions.push(sql`sum(s.impressions) >= ${filters.min_impressions}`);
  }
  if (filters.min_clicks !== undefined) {
    conditions.push(sql`sum(s.clicks) >= ${filters.min_clicks}`);
  }
  return conditions;
}

export type SortDirection = "asc" | "desc";

/**
 * ORDER BY from an allowlist. An unknown key falls back to `fallback`, so a
 * sort parameter can never inject SQL or reference an unexpected column.
 */
export function orderBy<A extends Record<string, SQL>>(
  allowed: A,
  key: string | undefined,
  direction: SortDirection,
  fallback: keyof A & string,
): { key: keyof A & string; clause: SQL } {
  const resolved = key !== undefined && Object.hasOwn(allowed, key) ? key : fallback;
  const dir = direction === "asc" ? sql`ASC` : sql`DESC`;
  return { key: resolved, clause: sql`${allowed[resolved]} ${dir} NULLS LAST` };
}
