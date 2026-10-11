"use client";

import { ChevronDown } from "lucide-react";
import { useId, useOptimistic, useTransition } from "react";
import { cn } from "@/lib/cn";
import { buttonClass } from "./button";
import { Popover } from "./popover";

export interface Option {
  value: string;
  label: string;
}

/**
 * A button that opens a checklist. The label shows what is selected.
 *
 * Ticks appear at once, even when `onChange` starts a navigation that takes a
 * moment to bring back the new `selected` list.
 */
export function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Option[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const groupId = useId();
  const [shown, setShown] = useOptimistic(selected);
  const [, startTransition] = useTransition();
  const chosen = options.filter((option) => shown.includes(option.value));
  const summary =
    chosen.length === 0
      ? "All"
      : chosen.length <= 2
        ? chosen.map((option) => option.label).join(", ")
        : `${chosen.length} selected`;

  function apply(next: string[]) {
    startTransition(() => {
      setShown(next);
      onChange(next);
    });
  }

  function toggle(value: string) {
    apply(shown.includes(value) ? shown.filter((item) => item !== value) : [...shown, value]);
  }

  return (
    <Popover
      trigger={
        <button
          type="button"
          className={buttonClass("secondary", "md", "max-w-56 justify-between gap-1.5")}
        >
          <span className="text-ink-3">{label}</span>
          <span className={cn("truncate", chosen.length > 0 && "font-semibold")}>{summary}</span>
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-ink-3" />
        </button>
      }
      className="min-w-48 p-1"
    >
      <fieldset aria-labelledby={groupId}>
        <legend id={groupId} className="sr-only">
          {label}
        </legend>
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-3"
          >
            <input
              type="checkbox"
              className="size-3.5 accent-(--accent)"
              checked={shown.includes(option.value)}
              onChange={() => toggle(option.value)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      {chosen.length > 0 ? (
        <div className="mt-1 border-t border-line pt-1">
          <button
            type="button"
            onClick={() => apply([])}
            className="w-full rounded-md px-2 py-1.5 text-left text-sm text-ink-2 hover:bg-surface-3"
          >
            Clear selection
          </button>
        </div>
      ) : null}
    </Popover>
  );
}
