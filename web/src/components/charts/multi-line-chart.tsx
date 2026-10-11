"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDate, formatMetric, type MetricFormat } from "@/lib/format";
import { ChartTooltip } from "./chart-tooltip";

export interface SeriesSpec {
  key: string;
  label: string;
  color: string;
}

export type MultiLineDatum = { date: string } & Record<string, number | string | null>;

const AXIS_TICK = { fontSize: 11, fill: "var(--ink-3)" } as const;

/** Several series on one y-axis. Identity comes from the legend and the tooltip, not colour alone. */
export function MultiLineChart({
  data,
  series,
  format,
  height = 240,
  ariaLabel,
}: {
  data: MultiLineDatum[];
  series: SeriesSpec[];
  format: MetricFormat;
  height?: number;
  ariaLabel: string;
}) {
  return (
    <div style={{ height }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="date"
            tickFormatter={(value: string) => formatDate(value)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: "var(--chart-axis)" }}
            minTickGap={40}
            tickMargin={6}
          />
          <YAxis
            width={40}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            tickCount={5}
            domain={[0, "auto"]}
            tickFormatter={(value: number) =>
              formatMetric(value, format === "score" ? "number" : format)
            }
          />
          <Tooltip
            cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as MultiLineDatum | undefined;
              if (!active || !point) return null;
              const rows = series
                .map((item) => ({ item, value: point[item.key] }))
                .filter(
                  (entry): entry is { item: SeriesSpec; value: number } =>
                    typeof entry.value === "number",
                )
                .sort((a, b) => b.value - a.value)
                .map(({ item, value }) => ({
                  label: item.label,
                  value: formatMetric(value, format),
                  color: item.color,
                }));
              return <ChartTooltip title={formatDate(point.date, "long")} rows={rows} />;
            }}
          />
          {series.map((item) => (
            <Line
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              stroke={item.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              dot={false}
              activeDot={{ r: 4, fill: item.color, stroke: "var(--surface)", strokeWidth: 2 }}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
