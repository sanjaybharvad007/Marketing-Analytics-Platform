import { ok } from "@/lib/api/envelope";
import { parseWith, route } from "@/lib/api/handler";
import { resolveQueryPeriods } from "@/lib/api/periods";
import { aiSummaryQuerySchema } from "@/lib/api/queries";
import { getAiSummary } from "@/lib/services/ai-visibility";

export const dynamic = "force-dynamic";

export const GET = route(async ({ query }) => {
  const filters = parseWith(aiSummaryQuerySchema, query);
  const periods = await resolveQueryPeriods(filters, query);
  return ok(await getAiSummary(filters, periods));
});
