import { created, ok, pageMeta } from "@/lib/api/envelope";
import { parseWith, readJson, route } from "@/lib/api/handler";
import { taskCreateSchema, taskListSchema } from "@/lib/api/schemas";
import { createTask, listTasks } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";

export const GET = route(async ({ query }) => {
  const parsed = parseWith(taskListSchema, query);
  const { rows, total } = await listTasks(parsed);
  return ok(rows, pageMeta(total, parsed.page, parsed.page_size));
});

/**
 * Create a task. Automation sends a `dedupe_key`; when a task with that key
 * exists it is returned unchanged with `meta.deduplicated = true` (200).
 */
export const POST = route(async ({ request }) => {
  const input = await readJson(request, taskCreateSchema);
  const { record, deduplicated } = await createTask(input);
  return deduplicated
    ? ok(record, { deduplicated: true })
    : created(record, { deduplicated: false });
});
