/** Query-string schemas of the read endpoints, shared by the handlers and the OpenAPI document. */
import { z } from "zod";
import { aiFilterShape } from "@/lib/filters/ai";
import { dateParams, pagingParams, positiveInt } from "@/lib/filters/params";
import { KPI_KEYS } from "@/lib/metrics";
import { seoFilterShape } from "@/lib/filters/seo";

const format = z.enum(["json", "csv"]).default("json");

export const overviewQuerySchema = z.object(dateParams);

export const timeseriesQuerySchema = z.object({
  ...dateParams,
  metric: z.enum(KPI_KEYS).default("sessions"),
  format,
});

export const seoQuerySchema = z.object({ ...seoFilterShape, format });

export const opportunitiesQuerySchema = z.object({
  ...dateParams,
  type: z.enum(["striking_distance", "decaying_pages", "ai_gaps"]),
  position_min: z.coerce.number().min(1).max(100).default(8),
  position_max: z.coerce.number().min(1).max(100).default(20),
  min_impressions: z.coerce.number().int().min(0).default(100),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const aiSummaryQuerySchema = z.object(aiFilterShape);

export const promptsQuerySchema = z.object({
  ...aiFilterShape,
  gaps_only: z.enum(["true", "false"]).default("false"),
  // With prompt_id the response is that prompt's newest answer per engine.
  prompt_id: positiveInt.optional(),
});

export const auditRunsQuerySchema = z.object(pagingParams);
