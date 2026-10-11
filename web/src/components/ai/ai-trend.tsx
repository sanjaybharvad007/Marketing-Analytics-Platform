"use client";

import { useState } from "react";
import { ChartFrame } from "@/components/charts/chart-frame";
import { MultiLineChart, type MultiLineDatum } from "@/components/charts/multi-line-chart";
import { TrendChart } from "@/components/charts/trend-chart";
import { Segmented } from "@/components/ui/segmented";
import { type Engine, ENGINE_LABELS, ENGINES } from "@/lib/domain";
import { formatDate, formatPosition } from "@/lib/format";
import type { AiTrendPoint } from "@/lib/services/ai-visibility";
import { ENGINE_COLORS } from "./engine-colors";

const VIEW_OPTIONS = [
  { value: "overall", label: "Overall" },
  { value: "engines", label: "By engine" },
] as const;

/** Seven-day moving average; daily scores on 40 prompts are too jumpy to read. */
function smooth(values: Array<number | null>, window = 7): Array<number | null> {
  return values.map((_, index) => {
    const slice = values
      .slice(Math.max(0, index - window + 1), index + 1)
      .filter((value): value is number => value !== null);
    return slice.length > 0 ? slice.reduce((sum, value) => sum + value, 0) / slice.length : null;
  });
}

export function AiTrend({ trend, engines }: { trend: AiTrendPoint[]; engines: Engine[] }) {
  const [view, setView] = useState<"overall" | "engines">("overall");
  const shown = ENGINES.filter((engine) => engines.includes(engine));
  const overall = smooth(trend.map((point) => point.score));
  const perEngine = Object.fromEntries(
    shown.map((engine) => [engine, smooth(trend.map((point) => point.by_engine[engine] ?? null))]),
  ) as Record<Engine, Array<number | null>>;

  const byEngine = view === "engines" && shown.length > 1;
  return (
    <ChartFrame
      title="Visibility score over time"
      description="Seven-day moving average of the daily score."
      legend={
        byEngine
          ? shown.map((engine) => ({ label: ENGINE_LABELS[engine], color: ENGINE_COLORS[engine] }))
          : undefined
      }
      actions={
        shown.length > 1 ? (
          <Segmented label="Series" options={VIEW_OPTIONS} value={view} onChange={setView} />
        ) : undefined
      }
      table={{
        columns: ["Date", "Overall", ...shown.map((engine) => ENGINE_LABELS[engine])],
        rows: trend.map((point, index) => [
          formatDate(point.date, "long"),
          formatPosition(overall[index]),
          ...shown.map((engine) => formatPosition(perEngine[engine][index])),
        ]),
      }}
    >
      {byEngine ? (
        <MultiLineChart
          data={trend.map((point, index) => {
            const row: MultiLineDatum = { date: point.date };
            for (const engine of shown) row[engine] = perEngine[engine][index] ?? null;
            return row;
          })}
          series={shown.map((engine) => ({
            key: engine,
            label: ENGINE_LABELS[engine],
            color: ENGINE_COLORS[engine],
          }))}
          format="score"
          height={240}
          ariaLabel="Visibility score by answer engine over time"
        />
      ) : (
        <TrendChart
          data={trend.map((point, index) => ({ date: point.date, value: overall[index] ?? null }))}
          label="Visibility score"
          format="score"
          height={240}
        />
      )}
    </ChartFrame>
  );
}
