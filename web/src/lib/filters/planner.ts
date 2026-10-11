import { z } from "zod";
import { PAGE_TYPES, PLAN_STATUSES, PRIORITIES } from "@/lib/domain";
import {
  normalizeParams,
  parseLenient,
  positiveInt,
  type RawParams,
  searchText,
  serializeParams,
} from "./params";

export const plannerPageSchema = z.object({
  status: z.enum(PLAN_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  page_type: z.enum(PAGE_TYPES).optional(),
  owner_id: positiveInt.optional(),
  q: searchText.optional(),
  view: z.enum(["table", "pipeline"]).default("table"),
});
export type PlannerPageState = z.output<typeof plannerPageSchema>;

export function parsePlannerState(params: RawParams | URLSearchParams): PlannerPageState {
  return parseLenient(plannerPageSchema, normalizeParams(params));
}

export function plannerStateToParams(state: Partial<PlannerPageState>): URLSearchParams {
  return serializeParams(plannerPageSchema, state);
}
