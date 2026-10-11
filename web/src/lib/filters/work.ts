import { z } from "zod";
import { PRIORITIES, TASK_SOURCES } from "@/lib/domain";
import {
  normalizeParams,
  parseLenient,
  positiveInt,
  type RawParams,
  serializeParams,
} from "./params";

export const workPageSchema = z.object({
  assignee_id: positiveInt.optional(),
  priority: z.enum(PRIORITIES).optional(),
  label: z.string().trim().toLowerCase().min(1).max(40).optional(),
  source: z.enum(TASK_SOURCES).optional(),
  due: z.enum(["overdue", "week", "none"]).optional(),
  view: z.enum(["board", "list"]).default("board"),
  // Opens this task's dialog; used by links from other pages.
  task: positiveInt.optional(),
});
export type WorkPageState = z.output<typeof workPageSchema>;

export function parseWorkState(params: RawParams | URLSearchParams): WorkPageState {
  return parseLenient(workPageSchema, normalizeParams(params));
}

export function workStateToParams(state: Partial<WorkPageState>): URLSearchParams {
  return serializeParams(workPageSchema, state);
}
