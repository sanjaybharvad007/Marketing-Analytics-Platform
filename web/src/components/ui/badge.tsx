import { Bot, CircleAlert, Info, Lightbulb, OctagonAlert, TriangleAlert, User } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import {
  type Priority,
  PRIORITY_LABELS,
  type Severity,
  SEVERITY_LABELS,
  TASK_SOURCE_LABELS,
  type TaskSource,
} from "@/lib/domain";
import { initials } from "@/lib/format";

type Tone = "neutral" | "accent" | "good" | "warning" | "bad";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-3 text-ink-2",
  accent: "bg-accent-soft text-accent-text",
  good: "bg-good-soft text-good-text",
  warning: "bg-warning-soft text-warning-text",
  bad: "bg-bad-soft text-bad-text",
};

export function Badge({
  children,
  tone = "neutral",
  className,
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const SEVERITY_STYLE: Record<Severity, { icon: typeof Info; color: string }> = {
  critical: { icon: OctagonAlert, color: "text-critical" },
  high: { icon: TriangleAlert, color: "text-serious" },
  medium: { icon: CircleAlert, color: "text-warning" },
  low: { icon: Info, color: "text-ink-3" },
};

/** Severity as icon plus label; the colour never carries the meaning alone. */
export function SeverityLabel({ severity, className }: { severity: Severity; className?: string }) {
  const { icon: Icon, color } = SEVERITY_STYLE[severity];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-ink", className)}>
      <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", color)} strokeWidth={2.25} />
      {SEVERITY_LABELS[severity]}
    </span>
  );
}

const PRIORITY_BARS: Record<Priority, number> = { low: 1, medium: 2, high: 3, urgent: 4 };

/** Priority as a four-step signal meter with its label. */
export function PriorityLabel({
  priority,
  showLabel = true,
}: {
  priority: Priority;
  showLabel?: boolean;
}) {
  const filled = PRIORITY_BARS[priority];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-2">
      <span aria-hidden="true" className="flex items-end gap-[2px]">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            style={{ height: 3 + step * 2 }}
            className={cn(
              "w-[3px] rounded-[1px]",
              step <= filled
                ? priority === "urgent"
                  ? "bg-critical"
                  : "bg-ink-2"
                : "bg-line-strong",
            )}
          />
        ))}
      </span>
      {showLabel ? (
        PRIORITY_LABELS[priority]
      ) : (
        <span className="sr-only">{PRIORITY_LABELS[priority]}</span>
      )}
    </span>
  );
}

const SOURCE_ICON: Record<TaskSource, typeof Info> = {
  manual: User,
  audit: CircleAlert,
  ai: Bot,
  opportunity: Lightbulb,
};

export function SourceBadge({ source }: { source: TaskSource }) {
  const Icon = SOURCE_ICON[source];
  return (
    <Badge tone={source === "manual" ? "neutral" : "accent"}>
      <Icon aria-hidden="true" className="size-3" />
      {TASK_SOURCE_LABELS[source]}
    </Badge>
  );
}

export function Avatar({ name, color, size = 20 }: { name: string; color: string; size?: number }) {
  return (
    <span
      title={name}
      aria-label={name}
      role="img"
      style={{ backgroundColor: color, width: size, height: size, fontSize: size * 0.42 }}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
    >
      {initials(name)}
    </span>
  );
}
