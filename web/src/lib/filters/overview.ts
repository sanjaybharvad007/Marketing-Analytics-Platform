import { z } from "zod";
import {
  dateParams,
  normalizeParams,
  parseLenient,
  type RawParams,
  serializeParams,
} from "./params";

export const overviewPageSchema = z.object(dateParams);
export type OverviewPageState = z.output<typeof overviewPageSchema>;

export function parseOverviewState(params: RawParams | URLSearchParams): OverviewPageState {
  return parseLenient(overviewPageSchema, normalizeParams(params));
}

export function overviewStateToParams(state: Partial<OverviewPageState>): URLSearchParams {
  return serializeParams(overviewPageSchema, state);
}
