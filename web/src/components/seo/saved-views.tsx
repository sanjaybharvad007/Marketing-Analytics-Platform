"use client";

import { Bookmark, Trash2 } from "lucide-react";
import { type FormEvent, useState, useTransition } from "react";
import { useFilterNavigation } from "@/components/shell/navigation";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Popover } from "@/components/ui/popover";
import { useToast } from "@/components/ui/toast";
import { deleteViewAction, saveViewAction } from "@/lib/actions/views";
import {
  parseSeoPageState,
  type SeoPageState,
  seoStateToParams,
  viewFilters,
} from "@/lib/filters/seo";
import type { SavedView } from "@/lib/services/views";

function viewParams(view: SavedView): URLSearchParams {
  const raw = Object.fromEntries(
    Object.entries(view.filters).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(",") : String(value),
    ]),
  );
  // Re-validate what was stored; anything no longer understood is dropped.
  return seoStateToParams(parseSeoPageState(raw));
}

/** Save the current filters under a name, and load or delete saved sets. */
export function SavedViews({ state, views }: { state: SeoPageState; views: SavedView[] }) {
  const { navigate } = useFilterNavigation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [isSaving, startSaving] = useTransition();
  const current = seoStateToParams({ ...state, page: 1 }).toString();

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    if (!name) {
      setError("Give the view a name.");
      return;
    }
    startSaving(async () => {
      const result = await saveViewAction({ name, report: "seo", filters: viewFilters(state) });
      if (result.ok) {
        setError(undefined);
        form.reset();
        toast.success(`Saved view "${result.data.name}"`);
      } else {
        setError(result.fieldErrors?.name ?? result.message);
      }
    });
  }

  function remove(view: SavedView) {
    startSaving(async () => {
      const result = await deleteViewAction(view.id);
      if (result.ok) toast.success(`Deleted view "${view.name}"`);
      else toast.error(result.message);
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="w-80 p-1"
      trigger={
        <button type="button" className={buttonClass("secondary", "md")}>
          <Bookmark aria-hidden="true" className="size-3.5 text-ink-3" />
          Saved views
          <span className="num text-ink-3">{views.length}</span>
        </button>
      }
    >
      {views.length === 0 ? (
        <p className="px-2.5 py-2 text-sm text-ink-3">
          No saved views yet. Set up the filters you check regularly and save them here.
        </p>
      ) : (
        <ul aria-label="Saved views">
          {views.map((view) => {
            const params = viewParams(view);
            const active = params.toString() === current;
            return (
              <li key={view.id} className="flex items-center gap-1">
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => {
                    navigate(params);
                    setOpen(false);
                  }}
                  className={`min-w-0 flex-1 truncate rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-3 ${
                    active ? "font-semibold" : ""
                  }`}
                >
                  {view.name}
                </button>
                <button
                  type="button"
                  aria-label={`Delete view ${view.name}`}
                  disabled={isSaving}
                  onClick={() => remove(view)}
                  className="rounded-md p-1.5 text-ink-3 hover:bg-bad-soft hover:text-bad-text"
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form
        onSubmit={save}
        className="mt-1 flex items-end gap-2 border-t border-line px-2.5 pt-2.5 pb-2"
      >
        <Field label="Save current filters as" error={error} className="min-w-0 flex-1">
          {(props) => <Input name="name" maxLength={80} placeholder="View name" {...props} />}
        </Field>
        <Button type="submit" variant="primary" disabled={isSaving} className={error ? "mb-5" : ""}>
          Save
        </Button>
      </form>
    </Popover>
  );
}
