import { ok } from "@/lib/api/envelope";
import { parseWith, route } from "@/lib/api/handler";
import { resolveQueryPeriods } from "@/lib/api/periods";
import { overviewQuerySchema } from "@/lib/api/queries";
import { getOverview } from "@/lib/services/overview";

export const dynamic = "force-dynamic";

export const GET = route(async ({ query }) => {
  const periods = await resolveQueryPeriods(parseWith(overviewQuerySchema, query), query);
  const overview = await getOverview(periods);
  return ok({ range: overview.range, compare: overview.compare, kpis: overview.kpis });
});
