import { ok } from "@/lib/api/envelope";
import { validationError } from "@/lib/api/errors";
import { parseWith, route } from "@/lib/api/handler";
import { resolveQueryPeriods } from "@/lib/api/periods";
import { opportunitiesQuerySchema } from "@/lib/api/queries";
import { previousPeriod } from "@/lib/dates";
import { listPrompts } from "@/lib/services/ai-visibility";
import { listDecayingPages, listStrikingDistance } from "@/lib/services/seo";

export const dynamic = "force-dynamic";

/**
 * Candidate lists for opportunity detection. The thresholds here are loose on
 * purpose; `map opportunities` applies its own scoring on top.
 */
export const GET = route(async ({ query }) => {
  const parsed = parseWith(opportunitiesQuerySchema, query);
  if (parsed.position_min > parsed.position_max) {
    throw validationError([{ path: "position_min", message: "Must not exceed position_max." }]);
  }
  const { current } = await resolveQueryPeriods(parsed, query);
  const meta = { type: parsed.type, range: current };

  if (parsed.type === "striking_distance") {
    const rows = await listStrikingDistance(current, {
      positionMin: parsed.position_min,
      positionMax: parsed.position_max,
      minImpressions: parsed.min_impressions,
      limit: parsed.limit,
    });
    return ok(rows, meta);
  }
  if (parsed.type === "decaying_pages") {
    const previous = previousPeriod(current);
    const rows = await listDecayingPages(current, previous, parsed.limit);
    return ok(rows, { ...meta, compare: previous });
  }
  const prompts = await listPrompts({ engine: [] }, current);
  return ok(
    prompts.map((row) => ({
      prompt_id: row.prompt_id,
      prompt: row.prompt,
      topic: row.topic,
      checks: row.checks,
      brand_mentions: row.brand_mentions,
      competitor_mentions: row.competitor_mentions,
      competitors: row.competitors,
    })),
    meta,
  );
});
