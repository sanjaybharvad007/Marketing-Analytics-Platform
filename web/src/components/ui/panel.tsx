import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Panel({
  children,
  className,
  as: Tag = "section",
  ...props
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "aside";
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  return (
    // `min-w-0` lets a panel shrink inside a grid or flex row instead of widening it.
    <Tag className={cn("min-w-0 rounded-lg border border-line bg-surface", className)} {...props}>
      {children}
    </Tag>
  );
}

export function PanelHeader({
  title,
  description,
  actions,
  id,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pt-3.5 pb-2",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 id={id} className="narrow text-base leading-5 font-semibold text-ink">
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-sm text-ink-3">{description}</p> : null}
      </div>
      {actions ? (
        <div className="flex max-w-full min-w-0 flex-wrap items-center gap-1.5">{actions}</div>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  titleAs: Title = "p",
  children,
  action,
  className,
}: {
  title: string;
  /** Use "h1" when the empty state is the whole page, as on the error pages. */
  titleAs?: "p" | "h1";
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-10 text-center", className)}>
      <svg
        aria-hidden="true"
        viewBox="0 0 96 56"
        className="mb-3 h-12 w-20 text-line-strong"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      >
        <path d="M6 44c10-18 24-30 42-30s32 12 42 30" />
        <path d="M20 44c7-11 16-18 28-18s21 7 28 18" />
        <path d="M34 44c4-5 8-8 14-8s10 3 14 8" />
      </svg>
      <Title className="font-semibold text-ink">{title}</Title>
      {children ? <div className="mt-1 max-w-md text-sm text-ink-3">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
