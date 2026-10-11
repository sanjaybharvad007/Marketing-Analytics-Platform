"use server";

import { revalidatePath } from "next/cache";
import { planCreateSchema, planPatchSchema } from "@/lib/api/schemas";
import { createPlan, deletePlan, getPlan, type Plan, updatePlan } from "@/lib/services/plans";
import { createTask, type Task } from "@/lib/services/tasks";
import { type ActionResult, runAction } from "./result";

function refresh() {
  revalidatePath("/planner");
  revalidatePath("/work");
}

/** Create a plan (`id` null) or update one, validating the form values. */
export async function savePlanAction(
  id: number | null,
  input: unknown,
): Promise<ActionResult<Plan>> {
  return runAction(async () => {
    const plan =
      id === null
        ? (await createPlan(planCreateSchema.parse(input))).record
        : await updatePlan(id, planPatchSchema.parse(input));
    refresh();
    return plan;
  });
}

export async function deletePlanAction(id: number): Promise<ActionResult> {
  return runAction(async () => {
    await deletePlan(id);
    refresh();
    return undefined;
  });
}

/** Queue the plan for `map briefs`, which writes the brief through the API. */
export async function requestBriefAction(id: number): Promise<ActionResult<Plan>> {
  return runAction(async () => {
    const plan = await updatePlan(id, { brief_status: "requested" });
    refresh();
    return plan;
  });
}

export async function createTaskFromPlanAction(id: number): Promise<ActionResult<Task>> {
  return runAction(async () => {
    const plan = await getPlan(id);
    const verb = plan.page_id ? "Update" : "Write";
    const { record } = await createTask({
      title: `${verb}: ${plan.title}`.slice(0, 200),
      description: plan.target_keyword ? `Target keyword: ${plan.target_keyword}` : null,
      status: "todo",
      priority: plan.priority,
      assignee_id: plan.owner_id,
      due_date: plan.due_date,
      labels: ["content"],
      plan_id: plan.id,
      page_id: plan.page_id,
      source: "manual",
    });
    refresh();
    return record;
  });
}
