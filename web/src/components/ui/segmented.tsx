"use client";

import { useOptimistic, useTransition } from "react";
import { cn } from "@/lib/cn";

/**
 * A small set of mutually exclusive choices shown side by side.
 *
 * The choice is shown as selected at once, even when `onChange` starts a
 * navigation that takes a moment to bring back the new `value`.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const [shown, setShown] = useOptimistic(value);
  const [, startTransition] = useTransition();

  function choose(next: T) {
    startTransition(() => {
      setShown(next);
      onChange(next);
    });
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex h-8 max-w-full items-center overflow-x-auto rounded-md border border-line-strong bg-surface p-0.5 [scrollbar-width:none]",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === shown;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => choose(option.value)}
            className={cn(
              "h-full shrink-0 rounded-[4px] px-2.5 text-sm whitespace-nowrap transition-colors",
              active ? "bg-surface-3 font-semibold text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
