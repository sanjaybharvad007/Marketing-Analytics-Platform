import { noContent, ok } from "@/lib/api/envelope";
import { idParam, readJson, route } from "@/lib/api/handler";
import { planPatchSchema } from "@/lib/api/schemas";
import { deletePlan, getPlan, updatePlan } from "@/lib/services/plans";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = route<Params>(async ({ params }) =>
  ok(await getPlan(idParam(params.id, "Plan"))),
);

export const PATCH = route<Params>(async ({ request, params }) => {
  const id = idParam(params.id, "Plan");
  return ok(await updatePlan(id, await readJson(request, planPatchSchema)));
});

export const DELETE = route<Params>(async ({ params }) => {
  await deletePlan(idParam(params.id, "Plan"));
  return noContent();
});
