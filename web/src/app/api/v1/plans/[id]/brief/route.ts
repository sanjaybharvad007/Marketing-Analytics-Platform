import { ok } from "@/lib/api/envelope";
import { idParam, readJson, route } from "@/lib/api/handler";
import { briefPutSchema } from "@/lib/api/schemas";
import { putBrief } from "@/lib/services/plans";

export const dynamic = "force-dynamic";

/** Store a generated brief (`status: "ready"`) or record a failure (`status: "failed"`). */
export const PUT = route<{ id: string }>(async ({ request, params }) => {
  const id = idParam(params.id, "Plan");
  return ok(await putBrief(id, await readJson(request, briefPutSchema)));
});
