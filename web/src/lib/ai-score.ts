/**
 * AI visibility score.
 *
 * Every answer an engine gives to a tracked prompt earns points:
 *   - 0.70 when the brand is the first tracked brand named,
 *     0.50 when second, 0.35 when third, 0.25 when fourth or later;
 *   - plus 0.30 when the answer cites a URL on the brand's domain.
 * The score is the average points per answer, scaled to 0-100. An answer that
 * names the brand first and cites it scores 100; one that ignores it scores 0.
 */
import { type SQL, sql } from "drizzle-orm";

export const SCORE_WEIGHTS = {
  rank1: 0.7,
  rank2: 0.5,
  rank3: 0.35,
  rank4Plus: 0.25,
  cited: 0.3,
} as const;

export interface VisibilityCounts {
  checks: number;
  rank1: number;
  rank2: number;
  rank3: number;
  rank4Plus: number;
  cited: number;
}

export function visibilityScore(counts: VisibilityCounts): number | null {
  if (counts.checks <= 0) return null;
  const points =
    counts.rank1 * SCORE_WEIGHTS.rank1 +
    counts.rank2 * SCORE_WEIGHTS.rank2 +
    counts.rank3 * SCORE_WEIGHTS.rank3 +
    counts.rank4Plus * SCORE_WEIGHTS.rank4Plus +
    counts.cited * SCORE_WEIGHTS.cited;
  return (100 * points) / counts.checks;
}

/** Summed score points over rows of mv_ai_visibility_daily (alias `v`). */
export const scorePointsSql: SQL = sql`sum(
  v.rank_1 * ${SCORE_WEIGHTS.rank1}::float8 + v.rank_2 * ${SCORE_WEIGHTS.rank2}::float8 +
  v.rank_3 * ${SCORE_WEIGHTS.rank3}::float8 + v.rank_4_plus * ${SCORE_WEIGHTS.rank4Plus}::float8 +
  v.cited * ${SCORE_WEIGHTS.cited}::float8
)`;
