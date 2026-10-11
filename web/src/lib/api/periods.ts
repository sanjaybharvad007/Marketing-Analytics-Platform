/** Resolve the `range`/`from`/`to`/`compare` query parameters of an API request. */
import { type ResolvedPeriods, resolvePeriods } from "@/lib/dates";
import { getDataAnchor } from "@/lib/services/meta";
import { validationError } from "./errors";

export interface DateQuery {
  range: "7d" | "28d" | "90d" | "custom";
  from?: string;
  to?: string;
  compare: "previous" | "none";
}

/**
 * Giving `from` and `to` without `range` selects a custom range. A custom
 * range must have both ends, in order.
 */
export async function resolveQueryPeriods(
  parsed: DateQuery,
  raw: Record<string, string>,
): Promise<ResolvedPeriods> {
  const range = raw.range === undefined && (parsed.from || parsed.to) ? "custom" : parsed.range;
  if (range === "custom") {
    if (!parsed.from || !parsed.to) {
      throw validationError([
        { path: parsed.from ? "to" : "from", message: "A custom range needs both from and to." },
      ]);
    }
    if (parsed.from > parsed.to) {
      throw validationError([{ path: "from", message: "from must not be after to." }]);
    }
  }
  return resolvePeriods({ ...parsed, range }, await getDataAnchor());
}
