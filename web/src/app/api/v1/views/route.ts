import { created, ok } from "@/lib/api/envelope";
import { parseWith, readJson, route } from "@/lib/api/handler";
import { viewCreateSchema, viewListSchema } from "@/lib/api/schemas";
import { createView, listViews } from "@/lib/services/views";

export const dynamic = "force-dynamic";

export const GET = route(async ({ query }) => {
  const { report } = parseWith(viewListSchema, query);
  const views = await listViews(report);
  return ok(views, { total: views.length });
});

export const POST = route(async ({ request }) => {
  return created(await createView(await readJson(request, viewCreateSchema)));
});
