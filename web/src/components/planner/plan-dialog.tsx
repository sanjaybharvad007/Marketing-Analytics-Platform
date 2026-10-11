"use client";

import { type FormEvent, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { deletePlanAction, savePlanAction } from "@/lib/actions/plans";
import {
  humanize,
  INTENTS,
  PAGE_TYPES,
  PLAN_STATUS_LABELS,
  PLAN_STATUSES,
  PRIORITIES,
  PRIORITY_LABELS,
} from "@/lib/domain";
import type { Member } from "@/lib/services/members";
import type { Plan } from "@/lib/services/plans";
import type { PageLookup } from "@/lib/services/seo";

function optionalNumber(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : Number(text);
}

function optionalText(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

/** Create or edit a content plan. Validation runs on the server and comes back per field. */
export function PlanDialog({
  plan,
  members,
  pages,
  onClose,
}: {
  /** The plan being edited, or null when creating. */
  plan: Plan | null;
  members: Member[];
  pages: PageLookup[];
  onClose: () => void;
}) {
  const toast = useToast();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = {
      title: String(form.get("title") ?? ""),
      target_keyword: optionalText(form.get("target_keyword")),
      intent: form.get("intent"),
      page_type: form.get("page_type"),
      status: form.get("status"),
      priority: form.get("priority"),
      owner_id: optionalNumber(form.get("owner_id")),
      page_id: optionalNumber(form.get("page_id")),
      target_url: optionalText(form.get("target_url")),
      est_monthly_traffic: optionalNumber(form.get("est_monthly_traffic")),
      due_date: optionalText(form.get("due_date")),
      notes: optionalText(form.get("notes")),
    };
    startTransition(async () => {
      const result = await savePlanAction(plan?.id ?? null, input);
      if (result.ok) {
        toast.success(plan ? "Plan saved" : "Plan created");
        onClose();
      } else {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.fieldErrors ? undefined : result.message);
      }
    });
  }

  function remove() {
    if (!plan || !window.confirm(`Delete the plan "${plan.title}"? Its tasks are kept.`)) return;
    startTransition(async () => {
      const result = await deletePlanAction(plan.id);
      if (result.ok) {
        toast.success("Plan deleted");
        onClose();
      } else {
        setFormError(result.message);
      }
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={plan ? "Edit plan" : "New plan"}
      description="A plan is one page to create or refresh, from idea through to published."
      size="lg"
      footer={
        <>
          {plan ? (
            <Button variant="danger" onClick={remove} disabled={isPending} className="mr-auto">
              Delete plan
            </Button>
          ) : null}
          <Button onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" form="plan-form" variant="primary" disabled={isPending}>
            {plan ? "Save changes" : "Create plan"}
          </Button>
        </>
      }
    >
      <form id="plan-form" onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
        {formError ? (
          <p
            role="alert"
            className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad-text sm:col-span-2"
          >
            {formError}
          </p>
        ) : null}
        <Field label="Title" error={errors.title} className="sm:col-span-2">
          {(props) => (
            <Input
              name="title"
              defaultValue={plan?.title ?? ""}
              maxLength={200}
              required
              {...props}
            />
          )}
        </Field>
        <Field label="Target keyword" error={errors.target_keyword}>
          {(props) => (
            <Input
              name="target_keyword"
              defaultValue={plan?.target_keyword ?? ""}
              maxLength={200}
              {...props}
            />
          )}
        </Field>
        <Field label="Search intent" error={errors.intent}>
          {(props) => (
            <Select name="intent" defaultValue={plan?.intent ?? "informational"} {...props}>
              {INTENTS.map((intent) => (
                <option key={intent} value={intent}>
                  {humanize(intent)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Page type" error={errors.page_type}>
          {(props) => (
            <Select name="page_type" defaultValue={plan?.page_type ?? "article"} {...props}>
              {PAGE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {humanize(type)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Status" error={errors.status}>
          {(props) => (
            <Select name="status" defaultValue={plan?.status ?? "idea"} {...props}>
              {PLAN_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {PLAN_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Priority" error={errors.priority}>
          {(props) => (
            <Select name="priority" defaultValue={plan?.priority ?? "medium"} {...props}>
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABELS[priority]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Owner" error={errors.owner_id}>
          {(props) => (
            <Select name="owner_id" defaultValue={plan?.owner_id ?? ""} {...props}>
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Existing page"
          error={errors.page_id}
          hint="Choose a page when the plan refreshes one that is already live."
          className="sm:col-span-2"
        >
          {(props) => (
            <Select name="page_id" defaultValue={plan?.page_id ?? ""} {...props}>
              <option value="">None (new page)</option>
              {pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.path}
                  {page.title ? `: ${page.title}` : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Target URL" error={errors.target_url} className="sm:col-span-2">
          {(props) => (
            <Input
              name="target_url"
              defaultValue={plan?.target_url ?? ""}
              placeholder="https://www.northpeak.example/guides/..."
              maxLength={500}
              {...props}
            />
          )}
        </Field>
        <Field label="Estimated monthly traffic" error={errors.est_monthly_traffic}>
          {(props) => (
            <Input
              name="est_monthly_traffic"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              defaultValue={plan?.est_monthly_traffic ?? ""}
              {...props}
            />
          )}
        </Field>
        <Field label="Due date" error={errors.due_date}>
          {(props) => (
            <Input name="due_date" type="date" defaultValue={plan?.due_date ?? ""} {...props} />
          )}
        </Field>
        <Field label="Notes" error={errors.notes} className="sm:col-span-2">
          {(props) => (
            <Textarea name="notes" defaultValue={plan?.notes ?? ""} maxLength={5000} {...props} />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
