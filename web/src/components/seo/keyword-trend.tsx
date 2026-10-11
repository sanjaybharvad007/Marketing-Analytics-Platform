"use client";

import { ChartFrame } from "@/components/charts/chart-frame";
import { MultiLineChart } from "@/components/charts/multi-line-chart";
import { formatDate } from "@/lib/format";
import type { KeywordTrendPoint } from "@/lib/services/seo";

const SERIES = [
  { key: "top3", label: "Top 3", color: "var(--series-1)" },
  { key: "top10", label: "Top 10", color: "var(--series-2)" },
  { key: "top20", label: "Top 20", color: "var(--series-3)" },
];

export function KeywordTrend({ points }: { points: KeywordTrendPoint[] }) {
  return (
    <ChartFrame
      title="Tracked keywords by ranking depth"
      description="How many tracked keywords rank within the top 3, 10 and 20 each day."
      legend={SERIES.map((series) => ({ label: series.label, color: series.color }))}
      table={{
        columns: ["Date", "Top 3", "Top 10", "Top 20", "Tracked"],
        rows: points.map((point) => [
          formatDate(point.date, "long"),
          point.top3,
          point.top10,
          point.top20,
          point.tracked,
        ]),
      }}
    >
      <MultiLineChart
        data={points.map((point) => ({ ...point }))}
        series={SERIES}
        format="number"
        height={230}
        ariaLabel="Tracked keywords in the top 3, top 10 and top 20 over time"
      />
    </ChartFrame>
  );
}
