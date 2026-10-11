/** AI visibility: score, mention and citation rates, share of voice, per-prompt status, gaps. */
import { type SQL, sql } from "drizzle-orm";
import { queryRows } from "@/db/client";
import { scorePointsSql } from "@/lib/ai-score";
import { type DateRange, eachDay, type ResolvedPeriods } from "@/lib/dates";
import { type Engine, ENGINES, type Intent, type Sentiment } from "@/lib/domain";
import { env } from "@/lib/env";
import { andAll, inList } from "@/lib/filters/sql";

export interface AiFilters {
  engine: Engine[];
  topic?: string;
}

/** A prompt is a gap when competitors appear in most answers and the brand in few. */
export const GAP_THRESHOLDS = { minCompetitorRate: 0.5, maxBrandRate: 0.2, minChecks: 5 } as const;

function rollupConditions(filters: AiFilters, range: DateRange): SQL[] {
  const conditions = [sql`v.date BETWEEN ${range.from} AND ${range.to}`];
  if (filters.engine.length > 0) conditions.push(inList(sql`v.engine`, filters.engine));
  if (filters.topic) conditions.push(sql`v.topic = ${filters.topic}`);
  return conditions;
}

function resultConditions(filters: AiFilters, range: DateRange): SQL[] {
  const conditions = [sql`r.date BETWEEN ${range.from} AND ${range.to}`];
  if (filters.engine.length > 0) conditions.push(inList(sql`r.engine`, filters.engine));
  if (filters.topic) conditions.push(sql`p.topic = ${filters.topic}`);
  return conditions;
}

export interface EngineSummary {
  engine: Engine;
  checks: number;
  mention_rate: number;
  citation_rate: number;
  score: number;
  score_prev: number | null;
}

export interface AiTrendPoint {
  date: string;
  score: number | null;
  mention_rate: number | null;
  by_engine: Partial<Record<Engine, number>>;
}

export interface ShareOfVoiceRow {
  name: string;
  is_brand: boolean;
  /** Answers that name this brand. */
  mentions: number;
  /** Share of answers that name this brand. */
  answer_rate: number;
  /** Share of all tracked-brand mentions. */
  share: number;
}

export interface TopicSummary {
  topic: string;
  checks: number;
  mention_rate: number;
  score: number;
}

export interface AiSummary {
  range: DateRange;
  compare: DateRange | null;
  checks: number;
  score: number | null;
  score_prev: number | null;
  mention_rate: number | null;
  mention_rate_prev: number | null;
  citation_rate: number | null;
  citation_rate_prev: number | null;
  positive_rate: number | null;
  by_engine: EngineSummary[];
  by_topic: TopicSummary[];
  trend: AiTrendPoint[];
  share_of_voice: ShareOfVoiceRow[];
}

interface Totals {
  checks: number;
  mentioned: number;
  cited: number;
  positive: number;
  points: number;
}

const TOTAL_COLUMNS = sql`
  sum(v.checks)::float8 AS checks,
  sum(v.mentioned)::float8 AS mentioned,
  sum(v.cited)::float8 AS cited,
  sum(v.positive)::float8 AS positive,
  ${scorePointsSql}::float8 AS points`;

const rate = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);
const score = (totals: Totals | undefined): number | null =>
  totals && totals.checks > 0 ? (100 * totals.points) / totals.checks : null;

async function periodTotals(filters: AiFilters, range: DateRange): Promise<Totals | undefined> {
  const [row] = await queryRows<Totals>(sql`
    SELECT ${TOTAL_COLUMNS}
    FROM mv_ai_visibility_daily v
    WHERE ${andAll(rollupConditions(filters, range))}
    HAVING sum(v.checks) > 0
  `);
  return row;
}

async function engineTotals(filters: AiFilters, range: DateRange): Promise<Map<Engine, Totals>> {
  const rows = await queryRows<Totals & { engine: Engine }>(sql`
    SELECT v.engine, ${TOTAL_COLUMNS}
    FROM mv_ai_visibility_daily v
    WHERE ${andAll(rollupConditions(filters, range))}
    GROUP BY v.engine
  `);
  return new Map(rows.map((row) => [row.engine, row]));
}

async function shareOfVoice(filters: AiFilters, range: DateRange): Promise<ShareOfVoiceRow[]> {
  const where = andAll(resultConditions(filters, range));
  const [totals] = await queryRows<{ checks: number; brand: number }>(sql`
    SELECT count(*)::float8 AS checks, (count(*) FILTER (WHERE r.brand_mentioned))::float8 AS brand
    FROM ai_visibility_results r
    JOIN ai_prompts p ON p.id = r.prompt_id
    WHERE ${where}
  `);
  const competitors = await queryRows<{ name: string; mentions: number }>(sql`
    SELECT c.name, count(*)::float8 AS mentions
    FROM ai_visibility_results r
    JOIN ai_prompts p ON p.id = r.prompt_id
    CROSS JOIN LATERAL unnest(r.competitors_mentioned) AS c(name)
    WHERE ${where}
    GROUP BY c.name
  `);
  const checks = totals?.checks ?? 0;
  const entries = [
    { name: env().BRAND_NAME, is_brand: true, mentions: totals?.brand ?? 0 },
    ...competitors.map((row) => ({ name: row.name, is_brand: false, mentions: row.mentions })),
  ];
  const allMentions = entries.reduce((sum, entry) => sum + entry.mentions, 0);
  return entries
    .map((entry) => ({
      ...entry,
      answer_rate: rate(entry.mentions, checks) ?? 0,
      share: rate(entry.mentions, allMentions) ?? 0,
    }))
    .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name));
}

async function trend(filters: AiFilters, range: DateRange): Promise<AiTrendPoint[]> {
  const rows = await queryRows<Totals & { date: string; engine: Engine }>(sql`
    SELECT v.date::text AS date, v.engine, ${TOTAL_COLUMNS}
    FROM mv_ai_visibility_daily v
    WHERE ${andAll(rollupConditions(filters, range))}
    GROUP BY v.date, v.engine
  `);
  const byDate = new Map<string, Array<Totals & { engine: Engine }>>();
  for (const row of rows) {
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }
  return eachDay(range).map((date) => {
    const day = byDate.get(date) ?? [];
    const checks = day.reduce((sum, row) => sum + row.checks, 0);
    const points = day.reduce((sum, row) => sum + row.points, 0);
    const mentioned = day.reduce((sum, row) => sum + row.mentioned, 0);
    const byEngine: Partial<Record<Engine, number>> = {};
    for (const row of day) {
      const value = score(row);
      if (value !== null) byEngine[row.engine] = value;
    }
    return {
      date,
      score: checks > 0 ? (100 * points) / checks : null,
      mention_rate: rate(mentioned, checks),
      by_engine: byEngine,
    };
  });
}

async function topicSummaries(filters: AiFilters, range: DateRange): Promise<TopicSummary[]> {
  const rows = await queryRows<Totals & { topic: string }>(sql`
    SELECT v.topic, ${TOTAL_COLUMNS}
    FROM mv_ai_visibility_daily v
    WHERE ${andAll(rollupConditions(filters, range))}
    GROUP BY v.topic
  `);
  return rows
    .map((row) => ({
      topic: row.topic,
      checks: row.checks,
      mention_rate: rate(row.mentioned, row.checks) ?? 0,
      score: score(row) ?? 0,
    }))
    .sort((a, b) => b.score - a.score);
}

export async function getAiSummary(
  filters: AiFilters,
  periods: ResolvedPeriods,
): Promise<AiSummary> {
  const { current, previous } = periods;
  const [totals, previousTotals, engines, previousEngines, voice, series, topics] =
    await Promise.all([
      periodTotals(filters, current),
      previous ? periodTotals(filters, previous) : undefined,
      engineTotals(filters, current),
      previous ? engineTotals(filters, previous) : new Map<Engine, Totals>(),
      shareOfVoice(filters, current),
      trend(filters, current),
      topicSummaries(filters, current),
    ]);

  const by_engine = ENGINES.flatMap((engine) => {
    const row = engines.get(engine);
    if (!row || row.checks === 0) return [];
    return [
      {
        engine,
        checks: row.checks,
        mention_rate: row.mentioned / row.checks,
        citation_rate: row.cited / row.checks,
        score: (100 * row.points) / row.checks,
        score_prev: score(previousEngines.get(engine)),
      },
    ];
  });

  return {
    range: current,
    compare: previous,
    checks: totals?.checks ?? 0,
    score: score(totals),
    score_prev: score(previousTotals),
    mention_rate: totals ? rate(totals.mentioned, totals.checks) : null,
    mention_rate_prev: previousTotals
      ? rate(previousTotals.mentioned, previousTotals.checks)
      : null,
    citation_rate: totals ? rate(totals.cited, totals.checks) : null,
    citation_rate_prev: previousTotals ? rate(previousTotals.cited, previousTotals.checks) : null,
    positive_rate: totals ? rate(totals.positive, totals.mentioned) : null,
    by_engine,
    by_topic: topics,
    trend: series,
    share_of_voice: voice,
  };
}

// --- prompts ------------------------------------------------------------------

export interface EngineStatus {
  checks: number;
  mentions: number;
  citations: number;
  /** State on the newest day in the range. */
  latest_mentioned: boolean;
  latest_rank: number | null;
  latest_cited: boolean;
}

export interface PromptRow {
  prompt_id: number;
  prompt: string;
  topic: string;
  intent: Intent;
  checks: number;
  brand_mentions: number;
  citations: number;
  /** Answers that name at least one competitor. */
  competitor_mentions: number;
  mention_rate: number;
  competitor_rate: number;
  competitors: Record<string, number>;
  engines: Partial<Record<Engine, EngineStatus>>;
  is_gap: boolean;
}

export function isGap(
  row: Pick<PromptRow, "checks" | "brand_mentions" | "competitor_mentions">,
): boolean {
  if (row.checks < GAP_THRESHOLDS.minChecks) return false;
  return (
    row.competitor_mentions / row.checks >= GAP_THRESHOLDS.minCompetitorRate &&
    row.brand_mentions / row.checks <= GAP_THRESHOLDS.maxBrandRate
  );
}

/** One row per tracked prompt with its totals and per-engine status over the range. */
export async function listPrompts(filters: AiFilters, range: DateRange): Promise<PromptRow[]> {
  const where = andAll(resultConditions(filters, range));
  const rows = await queryRows<
    Omit<PromptRow, "mention_rate" | "competitor_rate" | "is_gap" | "competitors" | "engines"> & {
      competitors: Record<string, number> | null;
      engines: Partial<Record<Engine, EngineStatus>> | null;
    }
  >(sql`
    WITH scoped AS (
      SELECT r.*, p.topic
      FROM ai_visibility_results r
      JOIN ai_prompts p ON p.id = r.prompt_id
      WHERE ${where}
    ), latest AS (
      SELECT max(date) AS day FROM scoped
    ), per_engine AS (
      SELECT s.prompt_id, s.engine,
             jsonb_build_object(
               'checks', count(*),
               'mentions', count(*) FILTER (WHERE s.brand_mentioned),
               'citations', count(*) FILTER (WHERE s.cited),
               'latest_mentioned', COALESCE(bool_or(s.brand_mentioned) FILTER (WHERE s.date = latest.day), FALSE),
               'latest_rank', min(s.brand_rank) FILTER (WHERE s.date = latest.day),
               'latest_cited', COALESCE(bool_or(s.cited) FILTER (WHERE s.date = latest.day), FALSE)
             ) AS status
      FROM scoped s CROSS JOIN latest
      GROUP BY s.prompt_id, s.engine
    ), engines AS (
      SELECT prompt_id, jsonb_object_agg(engine, status) AS engines
      FROM per_engine GROUP BY prompt_id
    ), competitor_counts AS (
      SELECT s.prompt_id, c.name, count(*) AS mentions
      FROM scoped s CROSS JOIN LATERAL unnest(s.competitors_mentioned) AS c(name)
      GROUP BY s.prompt_id, c.name
    ), competitors AS (
      SELECT prompt_id, jsonb_object_agg(name, mentions) AS competitors
      FROM competitor_counts GROUP BY prompt_id
    ), totals AS (
      SELECT s.prompt_id,
             count(*)::int AS checks,
             (count(*) FILTER (WHERE s.brand_mentioned))::int AS brand_mentions,
             (count(*) FILTER (WHERE s.cited))::int AS citations,
             (count(*) FILTER (WHERE cardinality(s.competitors_mentioned) > 0))::int AS competitor_mentions
      FROM scoped s GROUP BY s.prompt_id
    )
    SELECT p.id AS prompt_id, p.prompt, p.topic, p.intent,
           t.checks, t.brand_mentions, t.citations, t.competitor_mentions,
           c.competitors, e.engines
    FROM totals t
    JOIN ai_prompts p ON p.id = t.prompt_id
    LEFT JOIN engines e ON e.prompt_id = t.prompt_id
    LEFT JOIN competitors c ON c.prompt_id = t.prompt_id
    ORDER BY p.topic, p.id
  `);
  return rows.map((row) => {
    const base = {
      ...row,
      competitors: row.competitors ?? {},
      engines: row.engines ?? {},
      mention_rate: row.checks > 0 ? row.brand_mentions / row.checks : 0,
      competitor_rate: row.checks > 0 ? row.competitor_mentions / row.checks : 0,
    };
    return { ...base, is_gap: isGap(base) };
  });
}

export interface PromptAnswer {
  date: string;
  engine: Engine;
  brand_mentioned: boolean;
  brand_rank: number | null;
  cited: boolean;
  cited_url: string | null;
  sentiment: Sentiment | null;
  competitors_mentioned: string[];
  answer_excerpt: string;
}

export interface PromptDetail {
  prompt_id: number;
  prompt: string;
  topic: string;
  intent: Intent;
  answers: PromptAnswer[];
}

/** The newest stored answer per engine for one prompt, within the range. */
export async function getPromptDetail(
  promptId: number,
  filters: AiFilters,
  range: DateRange,
): Promise<PromptDetail | null> {
  const [prompt] = await queryRows<Omit<PromptDetail, "answers">>(
    sql`SELECT id AS prompt_id, prompt, topic, intent FROM ai_prompts WHERE id = ${promptId}`,
  );
  if (!prompt) return null;
  const conditions = [
    sql`r.prompt_id = ${promptId}`,
    sql`r.date BETWEEN ${range.from} AND ${range.to}`,
  ];
  if (filters.engine.length > 0) conditions.push(inList(sql`r.engine`, filters.engine));
  const answers = await queryRows<PromptAnswer>(sql`
    SELECT DISTINCT ON (r.engine)
           r.date::text AS date, r.engine, r.brand_mentioned, r.brand_rank::int AS brand_rank,
           r.cited, r.cited_url, r.sentiment, r.competitors_mentioned, r.answer_excerpt
    FROM ai_visibility_results r
    WHERE ${andAll(conditions)}
    ORDER BY r.engine, r.date DESC
  `);
  const order = new Map(ENGINES.map((engine, index) => [engine, index]));
  return {
    ...prompt,
    answers: [...answers].sort((a, b) => (order.get(a.engine) ?? 0) - (order.get(b.engine) ?? 0)),
  };
}

export async function listTopics(): Promise<string[]> {
  const rows = await queryRows<{ topic: string }>(
    sql`SELECT DISTINCT topic FROM ai_prompts WHERE active ORDER BY topic`,
  );
  return rows.map((row) => row.topic);
}
