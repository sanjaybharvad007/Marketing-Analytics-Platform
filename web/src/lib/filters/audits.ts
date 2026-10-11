import { z } from "zod";
import { ISSUE_STATUSES, SEVERITIES } from "@/lib/domain";
import {
  normalizeParams,
  parseLenient,
  type RawParams,
  searchText,
  serializeParams,
} from "./params";

export const auditsPageSchema = z.object({
  severity: z.enum(SEVERITIES).optional(),
  rule: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .max(60)
    .optional(),
  status: z.enum(ISSUE_STATUSES).optional(),
  q: searchText.optional(),
  page: z.coerce.number().int().min(1).default(1),
});
export type AuditsPageState = z.output<typeof auditsPageSchema>;

export function parseAuditsState(params: RawParams | URLSearchParams): AuditsPageState {
  return parseLenient(auditsPageSchema, normalizeParams(params));
}

export function auditsStateToParams(state: Partial<AuditsPageState>): URLSearchParams {
  return serializeParams(auditsPageSchema, state);
}
