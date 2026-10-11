"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatCompact,
  formatDate,
  formatMetric,
  formatPercent,
  type MetricFormat,
} from "@/lib/format";
import { ChartTooltip, type TooltipRow } from "./chart-tooltip";

export interface TrendDatum {
  date: string;
  value: number | null;
  previous?: number | null;
  previousDate?: string;
}

const AXIS_TICK = { fontSize: 11, fill: "var(--ink-3)" } as const;

function axisFormat(value: number, format: MetricFormat): string {
  if (format === "percent") return formatPercent(value, value < 0.1 ? 1 : 0);
  if (format === "position" || format === "score") return String(Math.round(value * 10) / 10);
  return formatCompact(value);
}

/**
 * One metric over time, with the previous period as a grey reference line.
 * A single y-axis; for average position the axis is reversed so that "up"
 * is always better. Counts start at zero and get an area wash; rates,
 * positions and scores use a fitted axis and a plain line.
 */
export function TrendChart({
  data,
  label,
  format,
  reversed = false,
  height = 240,
}: {
  data: TrendDatum[];
  label: string;
  format: MetricFormat;
  reversed?: boolean;
  height?: number;
}) {
  const hasPrevious = data.some((point) => point.previous !== undefined && point.previous !== null);
  const last = [...data].reverse().find((point) => point.value !== null);
  const startsAtZero = format === "number" || format === "currency";

  return (
    <div style={{ height }} role="img" aria-label={`${label} over time`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 20, right: 28, bottom: 0, left: 0 }}>
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
            width={48}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            tickCount={5}
            reversed={reversed}
            domain={startsAtZero ? [0, "auto"] : ["auto", "auto"]}
            tickFormatter={(value: number) => axisFormat(value, format)}
          />
          <Tooltip
            cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as TrendDatum | undefined;
              if (!active || !point) return null;
              const rows: TooltipRow[] = [
                {
                  label,
                  value: formatMetric(point.value, format),
                  color: "var(--series-1)",
                },
              ];
              if (hasPrevious) {
                rows.push({
                  label: point.previousDate
                    ? `Previous (${formatDate(point.previousDate)})`
                    : "Previous",
                  value: formatMetric(point.previous, format),
                  color: "var(--series-muted)",
                });
              }
              return <ChartTooltip title={formatDate(point.date, "long")} rows={rows} />;
            }}
          />
          {hasPrevious ? (
            <Line
              type="monotone"
              dataKey="previous"
              stroke="var(--series-muted)"
              strokeWidth={1.5}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
              connectNulls
            />
          ) : null}
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--series-1)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill={startsAtZero ? "var(--series-1-soft)" : "none"}
            dot={false}
            activeDot={{ r: 4, fill: "var(--series-1)", stroke: "var(--surface)", strokeWidth: 2 }}
            isAnimationActive={false}
            connectNulls
          />
          {last && last.value !== null ? (
            <ReferenceDot
              x={last.date}
              y={last.value}
              r={4}
              fill="var(--series-1)"
              stroke="var(--surface)"
              strokeWidth={2}
              label={{
                value: formatMetric(last.value, format),
                position: "top",
                fontSize: 11,
                fontWeight: 600,
                fill: "var(--ink)",
              }}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
