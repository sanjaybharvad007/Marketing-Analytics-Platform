"use client";

import { ChartFrame } from "@/components/charts/chart-frame";
import { TrendChart } from "@/components/charts/trend-chart";
import { formatDate } from "@/lib/format";
import type { RunHistoryPoint } from "@/lib/services/audits";

export function HistoryChart({ runs }: { runs: RunHistoryPoint[] }) {
  return (
    <ChartFrame
      title="Health score by run"
      description="Each point is one crawl."
      table={{
        columns: ["Run", "Health score", "Issues"],
        rows: runs.map((run) => [
          formatDate(run.date, "long"),
          run.health_score.toFixed(1),
          run.issues_total,
        ]),
      }}
    >
      <TrendChart
        data={runs.map((run) => ({ date: run.date, value: run.health_score }))}
        label="Health score"
        format="score"
        height={200}
      />
    </ChartFrame>
  );
}
