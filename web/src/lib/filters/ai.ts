/** Filter model for the AI visibility report and its API endpoints. */
import { z } from "zod";
import { ENGINES } from "@/lib/domain";
import {
  csv,
  dateParams,
  normalizeParams,
  parseLenient,
  positiveInt,
  type RawParams,
  serializeParams,
} from "./params";

export const aiFilterShape = {
  ...dateParams,
  engine: csv(z.enum(ENGINES)).default([]),
  topic: z.string().trim().min(1).max(80).optional(),
};
export const aiFilterSchema = z.object(aiFilterShape);

export const aiPageSchema = z.object({
  ...aiFilterShape,
  // The prompt whose stored answers are shown in the detail panel.
  prompt: positiveInt.optional(),
  show: z.enum(["all", "gaps"]).default("all"),
});
export type AiPageState = z.output<typeof aiPageSchema>;

export function parseAiPageState(params: RawParams | URLSearchParams): AiPageState {
  return parseLenient(aiPageSchema, normalizeParams(params));
}

export function aiStateToParams(state: Partial<AiPageState>): URLSearchParams {
  return serializeParams(aiPageSchema, state);
}
