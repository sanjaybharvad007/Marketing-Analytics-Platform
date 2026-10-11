"use client";

import { useState } from "react";
import { ChartFrame } from "@/components/charts/chart-frame";
import { TrendChart, type TrendDatum } from "@/components/charts/trend-chart";
import { Segmented } from "@/components/ui/segmented";
import { formatDate, formatMetric, type MetricFormat } from "@/lib/format";
import { SEO_METRICS, type SeoMetric } from "@/lib/filters/seo";
import type { SearchTrend } from "@/lib/services/seo";

const METRIC_SPEC: Record<SeoMetric, { label: string; format: MetricFormat; reversed: boolean }> = {
  clicks: { label: "Clicks", format: "number", reversed: false },
  impressions: { label: "Impressions", format: "number", reversed: false },
  ctr: { label: "CTR", format: "percent", reversed: false },
  position: { label: "Average position", format: "position", reversed: true },
};

/**
 * Daily trend for the filtered slice. The metric switch changes which series
 * is drawn (one y-axis at a time) and is mirrored into the URL so a shared
 * link opens on the same metric.
 */
export function SeoTrend({
  trend,
  initialMetric,
}: {
  trend: SearchTrend;
  initialMetric: SeoMetric;
}) {
  const [metric, setMetric] = useState<SeoMetric>(initialMetric);
  const spec = METRIC_SPEC[metric];
  const compared = trend.previousSeries !== null;

  function choose(next: SeoMetric) {
    setMetric(next);
    const url = new URL(window.location.href);
    if (next === "clicks") url.searchParams.delete("metric");
    else url.searchParams.set("metric", next);
    window.history.replaceState(null, "", url);
  }

  const data: TrendDatum[] = trend.series.map((point, index) => ({
    date: point.date,
    value: point[metric],
    previous: trend.previousSeries?.[index]?.[metric],
    previousDate: trend.previousSeries?.[index]?.date,
  }));

  return (
    <ChartFrame
      title={`${spec.label} per day`}
      description={
        metric === "position"
          ? "Lower is better, so the axis is reversed: a rising line is an improvement."
          : "For the queries and pages that match the filters above."
      }
      legend={
        compared
          ? [
              { label: "Selected period", color: "var(--series-1)" },
              { label: "Previous period", color: "var(--series-muted)" },
            ]
          : undefined
      }
      actions={
        <Segmented
          label="Metric"
          value={metric}
          onChange={choose}
          options={SEO_METRICS.map((key) => ({ value: key, label: METRIC_SPEC[key].label }))}
        />
      }
      table={{
        columns: compared ? ["Date", spec.label, "Previous period"] : ["Date", spec.label],
        rows: data.map((point) =>
          compared
            ? [
                formatDate(point.date, "long"),
                formatMetric(point.value, spec.format),
                formatMetric(point.previous, spec.format),
              ]
            : [formatDate(point.date, "long"), formatMetric(point.value, spec.format)],
        ),
      }}
    >
      <TrendChart
        data={data}
        label={spec.label}
        format={spec.format}
        reversed={spec.reversed}
        height={230}
      />
    </ChartFrame>
  );
}
