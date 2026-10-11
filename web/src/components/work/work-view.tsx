"use client";

import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useFilterNavigation } from "@/components/shell/navigation";
import { Avatar, Badge, PriorityLabel, SourceBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { EmptyState, Panel } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import {
  PRIORITIES,
  PRIORITY_LABELS,
  TASK_SOURCE_LABELS,
  TASK_SOURCES,
  TASK_STATUS_LABELS,
  type TaskStatus,
} from "@/lib/domain";
import { type WorkPageState, workStateToParams } from "@/lib/filters/work";
import { formatDate } from "@/lib/format";
import type { Member } from "@/lib/services/members";
import type { Task } from "@/lib/services/tasks";
import { Board } from "./board";
import { type PlanOption, TaskDialog } from "./task-dialog";

const VIEW_OPTIONS = [
  { value: "board", label: "Board" },
  { value: "list", label: "List" },
] as const;

const DUE_OPTIONS = [
  ["overdue", "Overdue"],
  ["week", "Due within 7 days"],
  ["none", "No due date"],
] as const;

interface Props {
  state: WorkPageState;
  tasks: Task[];
  members: Member[];
  plans: PlanOption[];
  labels: string[];
}

export function WorkView({ state, tasks, members, plans, labels }: Props) {
  const { navigate } = useFilterNavigation();
  const linked = state.task ? (tasks.find((task) => task.id === state.task) ?? null) : null;
  const [dialog, setDialog] = useState<{ task: Task | null; status?: TaskStatus } | null>(
    linked ? { task: linked } : null,
  );

  const update = (changes: Partial<WorkPageState>) =>
    navigate(workStateToParams({ ...state, ...changes, task: undefined }));
  const filtered = Boolean(
    state.assignee_id || state.priority || state.label || state.source || state.due,
  );

  // Remount the board whenever the server sends a different set or order of
  // tasks, so its optimistic state never drifts from what is stored.
  const boardKey = useMemo(
    () =>
      tasks
        .map((task) => `${task.id}:${task.status}:${task.sort_order}:${task.updated_at}`)
        .join("|"),
    [tasks],
  );

  function closeDialog() {
    setDialog(null);
    if (state.task) navigate(workStateToParams({ ...state, task: undefined }));
  }

  const filters = (
    [
      ["assignee_id", "All assignees", members.map((m) => [String(m.id), m.name] as const)],
      ["priority", "All priorities", PRIORITIES.map((p) => [p, PRIORITY_LABELS[p]] as const)],
      ["label", "All labels", labels.map((label) => [label, label] as const)],
      ["source", "All sources", TASK_SOURCES.map((s) => [s, TASK_SOURCE_LABELS[s]] as const)],
      ["due", "Any due date", DUE_OPTIONS],
    ] as const
  ).map(([key, placeholder, options]) => (
    <div key={key} className="w-40">
      <label htmlFor={`task-${key}`} className="sr-only">
        {placeholder}
      </label>
      <Select
        id={`task-${key}`}
        value={String(state[key] ?? "")}
        onChange={(event) =>
          update({ [key]: event.target.value || undefined } as Partial<WorkPageState>)
        }
      >
        <option value="">{placeholder}</option>
        {options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
    </div>
  ));

  return (
    <>
      <div
        className="mb-3 flex flex-wrap items-center gap-2"
        role="search"
        aria-label="Task filters"
      >
        {filters}
        {filtered ? (
          <button
            type="button"
            onClick={() => navigate(workStateToParams({ view: state.view }))}
            className="rounded-sm px-1 text-sm text-accent-text hover:underline"
          >
            Clear filters
          </button>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Segmented
            label="Layout"
            options={VIEW_OPTIONS}
            value={state.view}
            onChange={(view) => update({ view })}
          />
          <Button variant="primary" onClick={() => setDialog({ task: null, status: "todo" })}>
            <Plus aria-hidden="true" className="size-4" />
            New task
          </Button>
        </div>
      </div>

      {tasks.length === 0 && state.view === "list" ? (
        <Panel>
          <EmptyState
            title={filtered ? "No tasks match these filters" : "No tasks yet"}
            action={
              <Button variant="primary" onClick={() => setDialog({ task: null, status: "todo" })}>
                Create a task
              </Button>
            }
          >
            {filtered
              ? "Change or clear the filters above."
              : "Tasks appear here when you add them, or when an audit or the opportunities script opens them."}
          </EmptyState>
        </Panel>
      ) : state.view === "board" ? (
        <Board
          key={boardKey}
          tasks={tasks}
          onOpen={(task) => setDialog({ task })}
          onAdd={(status) => setDialog({ task: null, status })}
        />
      ) : (
        <Panel className="overflow-hidden">
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Task</Th>
                  <Th>Status</Th>
                  <Th>Priority</Th>
                  <Th>Assignee</Th>
                  <Th align="right">Due</Th>
                  <Th>Labels</Th>
                  <Th>Related to</Th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id} className="hover:bg-surface-2">
                    <Td className="max-w-96 min-w-64">
                      <button
                        type="button"
                        onClick={() => setDialog({ task })}
                        className="block max-w-full truncate text-left font-medium hover:text-accent-text hover:underline"
                        title={task.title}
                      >
                        {task.title}
                      </button>
                    </Td>
                    <Td>
                      <Badge tone={task.status === "done" ? "good" : "neutral"}>
                        {TASK_STATUS_LABELS[task.status]}
                      </Badge>
                    </Td>
                    <Td>
                      <PriorityLabel priority={task.priority} />
                    </Td>
                    <Td>
                      {task.assignee ? (
                        <span className="flex items-center gap-1.5 whitespace-nowrap">
                          <Avatar name={task.assignee.name} color={task.assignee.color} />
                          {task.assignee.name.split(" ")[0]}
                        </span>
                      ) : (
                        <span className="text-ink-3">Unassigned</span>
                      )}
                    </Td>
                    <Td
                      align="right"
                      className={cn(
                        "whitespace-nowrap",
                        task.overdue && "font-semibold text-bad-text",
                      )}
                    >
                      {task.due_date ? formatDate(task.due_date) : "–"}
                      {task.overdue ? <span className="sr-only"> (overdue)</span> : null}
                    </Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {task.source !== "manual" ? <SourceBadge source={task.source} /> : null}
                        {task.labels.map((label) => (
                          <Badge key={label}>{label}</Badge>
                        ))}
                      </span>
                    </Td>
                    <Td className="max-w-64 truncate text-ink-2">
                      {task.plan?.title ??
                        task.page?.path ??
                        (task.audit_issue ? "Audit issue" : "–")}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Panel>
      )}

      {dialog ? (
        <TaskDialog
          key={dialog.task?.id ?? `new-${dialog.status}`}
          task={dialog.task}
          defaultStatus={dialog.status}
          members={members}
          plans={plans}
          onClose={closeDialog}
        />
      ) : null}
    </>
  );
}
