import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import { computeDelta, type MetricFormat } from "@/lib/format";

const TONE_CLASS = {
  good: "text-good-text",
  bad: "text-bad-text",
  neutral: "text-ink-3",
} as const;

/**
 * Change versus the comparison period: signed value, direction arrow and a
 * colour for whether the movement is an improvement.
 */
export function DeltaLabel({
  current,
  previous,
  format = "number",
  higherIsBetter = true,
  className,
}: {
  current: number | null | undefined;
  previous: number | null | undefined;
  format?: MetricFormat;
  higherIsBetter?: boolean;
  className?: string;
}) {
  const delta = computeDelta(current, previous, format, higherIsBetter);
  if (!delta) return <span className={cn("text-ink-3", className)}>–</span>;
  const Icon =
    delta.direction === "up" ? ArrowUpRight : delta.direction === "down" ? ArrowDownRight : Minus;
  const meaning =
    delta.tone === "good" ? "improved" : delta.tone === "bad" ? "worsened" : "unchanged";
  return (
    <span
      className={cn(
        "num inline-flex items-center gap-0.5 whitespace-nowrap",
        TONE_CLASS[delta.tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.25} />
      {delta.label}
      <span className="sr-only"> ({meaning})</span>
    </span>
  );
}
