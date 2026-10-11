/** The headline metrics: keys, labels and how each is formatted and judged. */
import type { MetricFormat } from "@/lib/format";

export const KPI_KEYS = [
  "sessions",
  "users",
  "conversions",
  "clicks",
  "impressions",
  "ctr",
  "position",
  "ai_visibility_score",
] as const;
export type KpiKey = (typeof KPI_KEYS)[number];

export interface KpiSpec {
  label: string;
  format: MetricFormat;
  higherIsBetter: boolean;
  description: string;
}

export const KPI_SPECS: Record<KpiKey, KpiSpec> = {
  sessions: {
    label: "Sessions",
    format: "number",
    higherIsBetter: true,
    description: "Sessions from all channels (GA4).",
  },
  users: {
    label: "Users",
    format: "number",
    higherIsBetter: true,
    description: "Daily users summed over the period (GA4).",
  },
  conversions: {
    label: "Conversions",
    format: "number",
    higherIsBetter: true,
    description: "Key events (GA4).",
  },
  clicks: {
    label: "Organic clicks",
    format: "number",
    higherIsBetter: true,
    description: "Clicks from Google Search (Search Console).",
  },
  impressions: {
    label: "Impressions",
    format: "number",
    higherIsBetter: true,
    description: "Search result impressions (Search Console).",
  },
  ctr: {
    label: "CTR",
    format: "percent",
    higherIsBetter: true,
    description: "Clicks divided by impressions.",
  },
  position: {
    label: "Average position",
    format: "position",
    higherIsBetter: false,
    description: "Impression-weighted average position. Lower is better.",
  },
  ai_visibility_score: {
    label: "AI visibility",
    format: "score",
    higherIsBetter: true,
    description: "0-100 score across tracked prompts and answer engines.",
  },
};
