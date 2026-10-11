"use server";

import { revalidatePath } from "next/cache";
import { taskCreateSchema, taskMoveSchema, taskPatchSchema } from "@/lib/api/schemas";
import { createTask, deleteTask, moveTask, type Task, updateTask } from "@/lib/services/tasks";
import { type ActionResult, runAction } from "./result";

function refresh() {
  revalidatePath("/work");
  revalidatePath("/");
}

/** Create a task (`id` null) or update one, validating the form values. */
export async function saveTaskAction(
  id: number | null,
  input: unknown,
): Promise<ActionResult<Task>> {
  return runAction(async () => {
    const task =
      id === null
        ? (await createTask(taskCreateSchema.parse(input))).record
        : await updateTask(id, taskPatchSchema.parse(input));
    refresh();
    return task;
  });
}

export async function deleteTaskAction(id: number): Promise<ActionResult> {
  return runAction(async () => {
    await deleteTask(id);
    refresh();
    return undefined;
  });
}

/** Persist a drag on the board: new column and neighbours. */
export async function moveTaskAction(input: unknown): Promise<ActionResult<Task>> {
  return runAction(async () => {
    const task = await moveTask(taskMoveSchema.parse(input));
    refresh();
    return task;
  });
}
