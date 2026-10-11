"use client";

import { CalendarRange, CalendarClock, FileText, ScanSearch } from "lucide-react";
import { Avatar, Badge, PriorityLabel, SourceBadge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { humanize } from "@/lib/domain";
import { formatDate } from "@/lib/format";
import type { Task } from "@/lib/services/tasks";

/** The face of a task: used on the board, in the drag overlay and nowhere else. */
export function TaskCard({
  task,
  onOpen,
  dragging = false,
}: {
  task: Task;
  onOpen?: () => void;
  dragging?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-surface p-2.5 text-sm",
        dragging ? "border-(--focus) shadow-lg" : "border-line",
        task.overdue && !dragging && "border-l-2 border-l-(--critical)",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="block w-full text-left leading-5 font-medium hover:text-accent-text hover:underline"
      >
        {task.title}
      </button>

      {task.plan || task.page || task.audit_issue ? (
        <ul className="mt-1.5 flex flex-col gap-0.5 text-xs text-ink-3">
          {task.plan ? (
            <li className="flex items-center gap-1" title={`Plan: ${task.plan.title}`}>
              <CalendarRange aria-hidden="true" className="size-3 shrink-0" />
              <span className="sr-only">Plan: </span>
              <span className="truncate">{task.plan.title}</span>
            </li>
          ) : null}
          {task.page ? (
            <li className="flex items-center gap-1" title={`Page: ${task.page.path}`}>
              <FileText aria-hidden="true" className="size-3 shrink-0" />
              <span className="sr-only">Page: </span>
              <span className="truncate">{task.page.path}</span>
            </li>
          ) : null}
          {task.audit_issue ? (
            <li className="flex items-center gap-1" title="Audit issue">
              <ScanSearch aria-hidden="true" className="size-3 shrink-0" />
              <span className="sr-only">Audit issue: </span>
              <span className="truncate">{humanize(task.audit_issue.rule)}</span>
            </li>
          ) : null}
        </ul>
      ) : null}

      {task.labels.length > 0 || task.source !== "manual" ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.source !== "manual" ? <SourceBadge source={task.source} /> : null}
          {task.labels.map((label) => (
            <Badge key={label}>{label}</Badge>
          ))}
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2">
        <PriorityLabel priority={task.priority} />
        <span className="flex items-center gap-1.5">
          {task.due_date ? (
            <span
              className={cn(
                "num flex items-center gap-1 text-xs",
                task.overdue ? "font-semibold text-bad-text" : "text-ink-3",
              )}
            >
              <CalendarClock aria-hidden="true" className="size-3" />
              {formatDate(task.due_date)}
              {task.overdue ? <span className="sr-only"> (overdue)</span> : null}
            </span>
          ) : null}
          {task.assignee ? <Avatar name={task.assignee.name} color={task.assignee.color} /> : null}
        </span>
      </div>
    </div>
  );
}
