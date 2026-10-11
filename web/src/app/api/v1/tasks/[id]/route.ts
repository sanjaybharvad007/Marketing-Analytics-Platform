import { noContent, ok } from "@/lib/api/envelope";
import { idParam, readJson, route } from "@/lib/api/handler";
import { taskPatchSchema } from "@/lib/api/schemas";
import { deleteTask, getTask, updateTask } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = route<Params>(async ({ params }) =>
  ok(await getTask(idParam(params.id, "Task"))),
);

export const PATCH = route<Params>(async ({ request, params }) => {
  const id = idParam(params.id, "Task");
  return ok(await updateTask(id, await readJson(request, taskPatchSchema)));
});

export const DELETE = route<Params>(async ({ params }) => {
  await deleteTask(idParam(params.id, "Task"));
  return noContent();
});
