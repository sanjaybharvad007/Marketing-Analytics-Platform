import { ok } from "@/lib/api/envelope";
import { idParam, readJson, route } from "@/lib/api/handler";
import { issuePatchSchema } from "@/lib/api/schemas";
import { updateIssueStatus } from "@/lib/services/audits";

export const dynamic = "force-dynamic";

export const PATCH = route<{ id: string }>(async ({ request, params }) => {
  const id = idParam(params.id, "Audit issue");
  const { status } = await readJson(request, issuePatchSchema);
  return ok(await updateIssueStatus(id, status));
});
