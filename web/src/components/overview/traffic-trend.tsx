"use client";

import { useState } from "react";
import { ChartFrame } from "@/components/charts/chart-frame";
import { TrendChart, type TrendDatum } from "@/components/charts/trend-chart";
import { Segmented } from "@/components/ui/segmented";
import { formatDate, formatMetric } from "@/lib/format";
import { KPI_SPECS, type KpiKey } from "@/lib/metrics";
import type { DailyMetrics } from "@/lib/services/overview";

const METRICS = ["sessions", "users", "conversions", "clicks"] as const satisfies readonly KpiKey[];
type TrendMetric = (typeof METRICS)[number];

export function TrafficTrend({
  series,
  previousSeries,
}: {
  series: DailyMetrics[];
  previousSeries: DailyMetrics[] | null;
}) {
  const [metric, setMetric] = useState<TrendMetric>("sessions");
  const spec = KPI_SPECS[metric];
  const data: TrendDatum[] = series.map((day, index) => ({
    date: day.date,
    value: day[metric],
    previous: previousSeries?.[index]?.[metric],
    previousDate: previousSeries?.[index]?.date,
  }));

  return (
    <ChartFrame
      title={`${spec.label} per day`}
      description={
        previousSeries ? "Blue is the selected period, grey the period before it." : undefined
      }
      legend={
        previousSeries
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
          onChange={setMetric}
          options={METRICS.map((key) => ({ value: key, label: KPI_SPECS[key].label }))}
        />
      }
      table={{
        columns: previousSeries ? ["Date", spec.label, "Previous period"] : ["Date", spec.label],
        rows: data.map((point) =>
          previousSeries
            ? [
                formatDate(point.date, "long"),
                formatMetric(point.value, spec.format),
                formatMetric(point.previous, spec.format),
              ]
            : [formatDate(point.date, "long"), formatMetric(point.value, spec.format)],
        ),
      }}
    >
      <TrendChart data={data} label={spec.label} format={spec.format} height={320} />
    </ChartFrame>
  );
}
