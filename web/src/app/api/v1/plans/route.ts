import { created, ok, pageMeta } from "@/lib/api/envelope";
import { parseWith, readJson, route } from "@/lib/api/handler";
import { planCreateSchema, planListSchema } from "@/lib/api/schemas";
import { createPlan, listPlans } from "@/lib/services/plans";

export const dynamic = "force-dynamic";

export const GET = route(async ({ query }) => {
  const parsed = parseWith(planListSchema, query);
  const { rows, total } = await listPlans(parsed);
  return ok(rows, pageMeta(total, parsed.page, parsed.page_size));
});

/** Create a plan. With a `dedupe_key` that already exists, the existing plan is returned (200). */
export const POST = route(async ({ request }) => {
  const input = await readJson(request, planCreateSchema);
  const { record, deduplicated } = await createPlan(input);
  return deduplicated
    ? ok(record, { deduplicated: true })
    : created(record, { deduplicated: false });
});
