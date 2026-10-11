"use client";

import Link from "next/link";
import { type FormEvent, useState, useTransition } from "react";
import { SeverityLabel, SourceBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { deleteTaskAction, saveTaskAction } from "@/lib/actions/tasks";
import {
  humanize,
  PRIORITIES,
  PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type TaskStatus,
} from "@/lib/domain";
import type { Member } from "@/lib/services/members";
import type { Task } from "@/lib/services/tasks";

export interface PlanOption {
  id: number;
  title: string;
}

function optionalNumber(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : Number(text);
}

function optionalText(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

function evidenceValue(value: unknown): string {
  if (value === null || value === undefined) return "–";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(3);
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** Create, edit or delete a task. Automation-created tasks also show their evidence. */
export function TaskDialog({
  task,
  defaultStatus = "todo",
  members,
  plans,
  onClose,
}: {
  task: Task | null;
  defaultStatus?: TaskStatus;
  members: Member[];
  plans: PlanOption[];
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
      description: optionalText(form.get("description")),
      status: form.get("status"),
      priority: form.get("priority"),
      assignee_id: optionalNumber(form.get("assignee_id")),
      due_date: optionalText(form.get("due_date")),
      plan_id: optionalNumber(form.get("plan_id")),
      labels: String(form.get("labels") ?? "")
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
    };
    startTransition(async () => {
      const result = await saveTaskAction(task?.id ?? null, input);
      if (result.ok) {
        toast.success(task ? "Task saved" : "Task created");
        onClose();
      } else {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.fieldErrors ? undefined : result.message);
      }
    });
  }

  function remove() {
    if (!task || !window.confirm(`Delete the task "${task.title}"?`)) return;
    startTransition(async () => {
      const result = await deleteTaskAction(task.id);
      if (result.ok) {
        toast.success("Task deleted");
        onClose();
      } else {
        setFormError(result.message);
      }
    });
  }

  const evidence = task?.evidence ? Object.entries(task.evidence) : [];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={task ? "Edit task" : "New task"}
      size="lg"
      footer={
        <>
          {task ? (
            <Button variant="danger" onClick={remove} disabled={isPending} className="mr-auto">
              Delete task
            </Button>
          ) : null}
          <Button onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" form="task-form" variant="primary" disabled={isPending}>
            {task ? "Save changes" : "Create task"}
          </Button>
        </>
      }
    >
      <form id="task-form" onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
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
              defaultValue={task?.title ?? ""}
              maxLength={200}
              required
              {...props}
            />
          )}
        </Field>
        <Field label="Description" error={errors.description} className="sm:col-span-2">
          {(props) => (
            <Textarea
              name="description"
              defaultValue={task?.description ?? ""}
              maxLength={5000}
              rows={4}
              {...props}
            />
          )}
        </Field>
        <Field label="Status" error={errors.status}>
          {(props) => (
            <Select name="status" defaultValue={task?.status ?? defaultStatus} {...props}>
              {TASK_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {TASK_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Priority" error={errors.priority}>
          {(props) => (
            <Select name="priority" defaultValue={task?.priority ?? "medium"} {...props}>
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABELS[priority]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Assignee" error={errors.assignee_id}>
          {(props) => (
            <Select name="assignee_id" defaultValue={task?.assignee_id ?? ""} {...props}>
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Due date" error={errors.due_date}>
          {(props) => (
            <Input name="due_date" type="date" defaultValue={task?.due_date ?? ""} {...props} />
          )}
        </Field>
        <Field
          label="Labels"
          error={errors.labels}
          hint="Separate labels with commas."
          className="sm:col-span-2"
        >
          {(props) => (
            <Input
              name="labels"
              defaultValue={task?.labels.join(", ") ?? ""}
              placeholder="seo, content"
              {...props}
            />
          )}
        </Field>
        <Field label="Related plan" error={errors.plan_id} className="sm:col-span-2">
          {(props) => (
            <Select name="plan_id" defaultValue={task?.plan_id ?? ""} {...props}>
              <option value="">None</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.title}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>

      {task &&
      (task.page || task.audit_issue || task.source !== "manual" || evidence.length > 0) ? (
        <div className="mt-4 border-t border-line pt-3 text-sm">
          <h3 className="narrow mb-2 text-base font-semibold">Context</h3>
          <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
            <dt className="text-ink-3">Created by</dt>
            <dd>
              <SourceBadge source={task.source} />
            </dd>
            {task.page ? (
              <>
                <dt className="text-ink-3">Page</dt>
                <dd className="min-w-0 truncate">
                  <Link
                    href={`/reports/seo?tab=queries&page_id=${task.page.id}`}
                    className="text-accent-text hover:underline"
                  >
                    {task.page.path}
                  </Link>
                </dd>
              </>
            ) : null}
            {task.audit_issue ? (
              <>
                <dt className="text-ink-3">Audit issue</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <SeverityLabel severity={task.audit_issue.severity} />
                  <Link
                    href={`/audits?rule=${task.audit_issue.rule}`}
                    className="text-accent-text hover:underline"
                  >
                    {humanize(task.audit_issue.rule)}
                  </Link>
                </dd>
              </>
            ) : null}
            {evidence.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-ink-3">{humanize(key)}</dt>
                <dd className="num min-w-0 break-words">{evidenceValue(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </Dialog>
  );
}
