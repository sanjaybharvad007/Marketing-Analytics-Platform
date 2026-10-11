import { ok } from "@/lib/api/envelope";
import { notFound } from "@/lib/api/errors";
import { parseWith, route } from "@/lib/api/handler";
import { resolveQueryPeriods } from "@/lib/api/periods";
import { promptsQuerySchema } from "@/lib/api/queries";
import { getPromptDetail, listPrompts } from "@/lib/services/ai-visibility";

export const dynamic = "force-dynamic";

export const GET = route(async ({ query }) => {
  const parsed = parseWith(promptsQuerySchema, query);
  const { current } = await resolveQueryPeriods(parsed, query);

  if (parsed.prompt_id !== undefined) {
    const detail = await getPromptDetail(parsed.prompt_id, parsed, current);
    if (!detail) throw notFound("Prompt");
    return ok(detail, { range: current });
  }
  const rows = await listPrompts(parsed, current);
  const data = parsed.gaps_only === "true" ? rows.filter((row) => row.is_gap) : rows;
  return ok(data, { total: data.length, range: current });
});
