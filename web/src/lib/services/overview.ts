/** Site-wide KPIs, daily series, channel mix and page movers for the overview and the metrics API. */
import { sql } from "drizzle-orm";
import { queryRows } from "@/db/client";
import { scorePointsSql } from "@/lib/ai-score";
import { KPI_KEYS, type KpiKey } from "@/lib/metrics";
import { type DateRange, eachDay, type ResolvedPeriods } from "@/lib/dates";

export type DailyMetrics = Record<KpiKey, number | null> & { date: string };

export interface KpiValue {
  value: number | null;
  previous: number | null;
}

export interface Overview {
  range: DateRange;
  compare: DateRange | null;
  kpis: Record<KpiKey, KpiValue>;
  series: DailyMetrics[];
  /** Previous-period days aligned by index with `series`; null without comparison. */
  previousSeries: DailyMetrics[] | null;
}

interface DailyTotals {
  sessions: number;
  users: number;
  conversions: number;
  clicks: number;
  impressions: number;
  sumPosition: number;
  aiChecks: number;
  aiPoints: number;
}

const EMPTY: DailyTotals = {
  sessions: 0,
  users: 0,
  conversions: 0,
  clicks: 0,
  impressions: 0,
  sumPosition: 0,
  aiChecks: 0,
  aiPoints: 0,
};

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function toMetrics(date: string, totals: DailyTotals | null | undefined): DailyMetrics {
  if (!totals) {
    return {
      date,
      sessions: null,
      users: null,
      conversions: null,
      clicks: null,
      impressions: null,
      ctr: null,
      position: null,
      ai_visibility_score: null,
    };
  }
  return {
    date,
    sessions: totals.sessions,
    users: totals.users,
    conversions: totals.conversions,
    clicks: totals.clicks,
    impressions: totals.impressions,
    ctr: ratio(totals.clicks, totals.impressions),
    position: ratio(totals.sumPosition, totals.impressions),
    ai_visibility_score: ratio(100 * totals.aiPoints, totals.aiChecks),
  };
}

function sumTotals(days: string[], byDate: Map<string, DailyTotals>): DailyTotals | null {
  let found = false;
  const total = { ...EMPTY };
  for (const day of days) {
    const row = byDate.get(day);
    if (!row) continue;
    found = true;
    for (const key of Object.keys(total) as Array<keyof DailyTotals>) total[key] += row[key];
  }
  return found ? total : null;
}

async function loadDailyTotals(range: DateRange): Promise<Map<string, DailyTotals>> {
  const [traffic, search, ai] = await Promise.all([
    queryRows<{ date: string; sessions: number; users: number; conversions: number }>(sql`
      SELECT date::text AS date, sum(sessions)::float8 AS sessions, sum(users)::float8 AS users,
             sum(conversions)::float8 AS conversions
      FROM mv_traffic_daily
      WHERE date BETWEEN ${range.from} AND ${range.to}
      GROUP BY date
    `),
    queryRows<{ date: string; clicks: number; impressions: number; sum_position: number }>(sql`
      SELECT date::text AS date, sum(clicks)::float8 AS clicks,
             sum(impressions)::float8 AS impressions, sum(sum_position)::float8 AS sum_position
      FROM mv_search_page_daily
      WHERE date BETWEEN ${range.from} AND ${range.to}
      GROUP BY date
    `),
    queryRows<{ date: string; checks: number; points: number }>(sql`
      SELECT v.date::text AS date, sum(v.checks)::float8 AS checks, ${scorePointsSql}::float8 AS points
      FROM mv_ai_visibility_daily v
      WHERE v.date BETWEEN ${range.from} AND ${range.to}
      GROUP BY v.date
    `),
  ]);

  const byDate = new Map<string, DailyTotals>();
  const entry = (date: string): DailyTotals => {
    let row = byDate.get(date);
    if (!row) {
      row = { ...EMPTY };
      byDate.set(date, row);
    }
    return row;
  };
  for (const row of traffic) {
    Object.assign(entry(row.date), {
      sessions: row.sessions,
      users: row.users,
      conversions: row.conversions,
    });
  }
  for (const row of search) {
    Object.assign(entry(row.date), {
      clicks: row.clicks,
      impressions: row.impressions,
      sumPosition: row.sum_position,
    });
  }
  for (const row of ai) {
    Object.assign(entry(row.date), { aiChecks: row.checks, aiPoints: row.points });
  }
  return byDate;
}

/** KPIs and daily series for the current period and, optionally, the previous one. */
export async function getOverview(periods: ResolvedPeriods): Promise<Overview> {
  const { current, previous } = periods;
  const span: DateRange = { from: previous?.from ?? current.from, to: current.to };
  const byDate = await loadDailyTotals(span);

  const currentDays = eachDay(current);
  const previousDays = previous ? eachDay(previous) : [];
  const currentTotal = sumTotals(currentDays, byDate);
  const previousTotal = previous ? sumTotals(previousDays, byDate) : null;
  const currentMetrics = toMetrics(current.to, currentTotal);
  const previousMetrics = toMetrics(previous?.to ?? current.from, previousTotal);

  const kpis = Object.fromEntries(
    KPI_KEYS.map((key) => [
      key,
      { value: currentMetrics[key], previous: previousMetrics[key] } satisfies KpiValue,
    ]),
  ) as Record<KpiKey, KpiValue>;

  return {
    range: current,
    compare: previous,
    kpis,
    series: currentDays.map((day) => toMetrics(day, byDate.get(day))),
    previousSeries: previous ? previousDays.map((day) => toMetrics(day, byDate.get(day))) : null,
  };
}

export interface ChannelRow {
  channel: string;
  sessions: number;
  sessions_prev: number | null;
  conversions: number;
  share: number;
}

export async function getChannelMix(periods: ResolvedPeriods): Promise<ChannelRow[]> {
  const { current, previous } = periods;
  const from = previous?.from ?? current.from;
  const rows = await queryRows<{
    channel: string;
    sessions: number;
    conversions: number;
    sessions_prev: number | null;
  }>(sql`
    SELECT channel,
           COALESCE(sum(sessions) FILTER (WHERE date >= ${current.from}), 0)::float8 AS sessions,
           COALESCE(sum(conversions) FILTER (WHERE date >= ${current.from}), 0)::float8 AS conversions,
           ${
             previous
               ? sql`COALESCE(sum(sessions) FILTER (WHERE date <= ${previous.to}), 0)::float8`
               : sql`NULL::float8`
           } AS sessions_prev
    FROM mv_traffic_daily
    WHERE date BETWEEN ${from} AND ${current.to}
    GROUP BY channel
    ORDER BY sessions DESC, channel
  `);
  const total = rows.reduce((sum, row) => sum + row.sessions, 0);
  return rows
    .filter((row) => row.sessions > 0 || (row.sessions_prev ?? 0) > 0)
    .map((row) => ({ ...row, share: total > 0 ? row.sessions / total : 0 }));
}

export interface PageMover {
  page_id: number;
  path: string;
  title: string | null;
  section: string;
  clicks: number;
  clicks_prev: number;
  clicks_delta: number;
}

/** Pages with the largest gain and loss in organic clicks versus the previous period. */
export async function getPageMovers(
  periods: ResolvedPeriods,
  limit = 5,
): Promise<{ growing: PageMover[]; declining: PageMover[] }> {
  const { current, previous } = periods;
  if (!previous) return { growing: [], declining: [] };
  const rows = await queryRows<PageMover>(sql`
    SELECT p.id AS page_id, p.path, p.title, p.section,
           COALESCE(sum(s.clicks) FILTER (WHERE s.date >= ${current.from}), 0)::float8 AS clicks,
           COALESCE(sum(s.clicks) FILTER (WHERE s.date <= ${previous.to}), 0)::float8 AS clicks_prev,
           (COALESCE(sum(s.clicks) FILTER (WHERE s.date >= ${current.from}), 0)
            - COALESCE(sum(s.clicks) FILTER (WHERE s.date <= ${previous.to}), 0))::float8 AS clicks_delta
    FROM mv_search_page_daily s
    JOIN pages p ON p.id = s.page_id
    WHERE s.date BETWEEN ${previous.from} AND ${current.to}
    GROUP BY p.id
  `);
  const sorted = [...rows].sort((a, b) => b.clicks_delta - a.clicks_delta);
  return {
    growing: sorted.filter((row) => row.clicks_delta > 0).slice(0, limit),
    declining: sorted
      .filter((row) => row.clicks_delta < 0)
      .reverse()
      .slice(0, limit),
  };
}
