"use client";

import { X } from "lucide-react";
import { useFilterNavigation } from "@/components/shell/navigation";
import { clearFilters, type FilterChip, removeChip } from "@/lib/filters/chips";
import { type SeoPageState, seoStateToParams } from "@/lib/filters/seo";

/** The active filters as removable chips, with one control to clear them all. */
export function FilterChips({ state, chips }: { state: SeoPageState; chips: FilterChip[] }) {
  const { navigate } = useFilterNavigation();
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      {chips.map((chip) => (
        <span
          key={`${chip.key}:${chip.value ?? ""}`}
          className="inline-flex h-6 items-center gap-1 rounded-md border border-line-strong bg-surface pr-0.5 pl-2 text-sm"
        >
          <span className="max-w-64 truncate">{chip.label}</span>
          <button
            type="button"
            aria-label={`Remove filter: ${chip.label}`}
            onClick={() => navigate(seoStateToParams(removeChip(state, chip)))}
            className="rounded-sm p-0.5 text-ink-3 hover:bg-surface-3 hover:text-ink"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => navigate(seoStateToParams(clearFilters(state)))}
        className="ml-1 rounded-sm px-1 text-sm text-accent-text hover:underline"
      >
        Clear all
      </button>
    </div>
  );
}
