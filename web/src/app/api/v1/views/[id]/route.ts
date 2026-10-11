import { noContent } from "@/lib/api/envelope";
import { idParam, route } from "@/lib/api/handler";
import { deleteView } from "@/lib/services/views";

export const dynamic = "force-dynamic";

export const DELETE = route<{ id: string }>(async ({ params }) => {
  await deleteView(idParam(params.id, "Saved view"));
  return noContent();
});
