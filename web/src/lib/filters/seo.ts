/** The SEO report's filter model: one Zod schema drives URL parsing, the API and SQL. */
import { z } from "zod";
import { DEVICES, PAGE_TYPES } from "@/lib/domain";
import {
  csv,
  dateParams,
  nonNegativeInt,
  pagingParams,
  parseLenient,
  positiveInt,
  type RawParams,
  normalizeParams,
  searchText,
  serializeParams,
  sortDirection,
} from "./params";

export const POSITION_BUCKETS = ["1-3", "4-10", "11-20", "21+"] as const;
export type PositionBucket = (typeof POSITION_BUCKETS)[number];

/** Inclusive upper bounds on average position; a bucket starts above the previous bound. */
export const POSITION_BOUNDS: Record<PositionBucket, { above: number; upTo: number | null }> = {
  "1-3": { above: 0, upTo: 3 },
  "4-10": { above: 3, upTo: 10 },
  "11-20": { above: 10, upTo: 20 },
  "21+": { above: 20, upTo: null },
};

export const SEO_TABS = ["queries", "pages", "keywords"] as const;
export type SeoTab = (typeof SEO_TABS)[number];

export const SEO_METRICS = ["clicks", "impressions", "ctr", "position"] as const;
export type SeoMetric = (typeof SEO_METRICS)[number];

const countryCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, "Expected a two-letter country code")
  .transform((value) => value.toUpperCase());

/** Filters shared by the report page and every /api/v1/seo endpoint. */
export const seoFilterShape = {
  ...dateParams,
  country: csv(countryCode).default([]),
  device: csv(z.enum(DEVICES)).default([]),
  section: csv(z.string().trim().min(1).max(40)).default([]),
  page_type: z.enum(PAGE_TYPES).optional(),
  brand: z.enum(["all", "brand", "non_brand"]).default("all"),
  position: csv(z.enum(POSITION_BUCKETS)).default([]),
  q: searchText.optional(),
  q_not: searchText.optional(),
  url: searchText.optional(),
  min_impressions: nonNegativeInt.optional(),
  min_clicks: nonNegativeInt.optional(),
  // Drill-downs: an exact query, or one page.
  query: z.string().trim().min(1).max(500).optional(),
  page_id: positiveInt.optional(),
  sort: z
    .string()
    .trim()
    .regex(/^[a-z_]+$/)
    .max(40)
    .optional(),
  dir: sortDirection.default("desc"),
  ...pagingParams,
};

export const seoFilterSchema = z.object(seoFilterShape);
export type SeoFilters = z.output<typeof seoFilterSchema>;

/** Page-only state that travels in the URL with the filters. */
export const seoPageSchema = z.object({
  ...seoFilterShape,
  tab: z.enum(SEO_TABS).default("queries"),
  metric: z.enum(SEO_METRICS).default("clicks"),
});
export type SeoPageState = z.output<typeof seoPageSchema>;

export function parseSeoPageState(params: RawParams | URLSearchParams): SeoPageState {
  return parseLenient(seoPageSchema, normalizeParams(params));
}

export function seoStateToParams(state: Partial<SeoPageState>): URLSearchParams {
  return serializeParams(seoPageSchema, state);
}

/** Keys that narrow the data, as opposed to paging, sorting or presentation. */
export const SEO_FILTER_KEYS = [
  "country",
  "device",
  "section",
  "page_type",
  "brand",
  "position",
  "q",
  "q_not",
  "url",
  "min_impressions",
  "min_clicks",
  "query",
  "page_id",
] as const satisfies ReadonlyArray<keyof SeoFilters>;
export type SeoFilterKey = (typeof SEO_FILTER_KEYS)[number];

/** State saved in a view: everything except the page number. */
export function viewFilters(state: SeoPageState): Record<string, unknown> {
  return Object.fromEntries(seoStateToParams({ ...state, page: 1 }).entries());
}
