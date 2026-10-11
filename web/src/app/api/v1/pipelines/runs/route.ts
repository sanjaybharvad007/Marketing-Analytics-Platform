import { ok, pageMeta } from "@/lib/api/envelope";
import { parseWith, route } from "@/lib/api/handler";
import { runListSchema } from "@/lib/api/schemas";
import { getFreshness, listPipelineRuns } from "@/lib/services/pipelines";

export const dynamic = "force-dynamic";

export const GET = route(async ({ query }) => {
  const parsed = parseWith(runListSchema, query);
  const [{ rows, total }, freshness] = await Promise.all([
    listPipelineRuns(parsed),
    getFreshness(),
  ]);
  return ok(rows, { ...pageMeta(total, parsed.page, parsed.page_size), freshness });
});
