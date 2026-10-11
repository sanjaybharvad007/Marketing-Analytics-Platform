"use server";

import { revalidatePath } from "next/cache";
import { viewCreateSchema } from "@/lib/api/schemas";
import { conflict } from "@/lib/api/errors";
import { createView, deleteView, listViews, type SavedView } from "@/lib/services/views";
import { type ActionResult, runAction } from "./result";

export async function saveViewAction(input: unknown): Promise<ActionResult<SavedView>> {
  return runAction(async () => {
    const parsed = viewCreateSchema.parse(input);
    const existing = await listViews(parsed.report);
    if (existing.some((view) => view.name.toLowerCase() === parsed.name.toLowerCase())) {
      throw conflict(`A view named "${parsed.name}" already exists. Choose another name.`);
    }
    const view = await createView(parsed);
    revalidatePath("/reports/seo");
    return view;
  });
}

export async function deleteViewAction(id: number): Promise<ActionResult> {
  return runAction(async () => {
    await deleteView(id);
    revalidatePath("/reports/seo");
    return undefined;
  });
}
