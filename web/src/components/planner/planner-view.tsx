"use client";

import {
  ChevronLeft,
  ChevronRight,
  FileText,
  ListPlus,
  Pencil,
  Plus,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useFilterNavigation } from "@/components/shell/navigation";
import { Avatar, Badge, PriorityLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, Panel } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { createTaskFromPlanAction, requestBriefAction, savePlanAction } from "@/lib/actions/plans";
import { cn } from "@/lib/cn";
import {
  type BriefStatus,
  humanize,
  PAGE_TYPES,
  PLAN_STATUS_LABELS,
  PLAN_STATUSES,
  type PlanStatus,
  PRIORITIES,
  PRIORITY_LABELS,
} from "@/lib/domain";
import { type PlannerPageState, plannerStateToParams } from "@/lib/filters/planner";
import { formatCompact, formatDate, formatInteger, formatPosition } from "@/lib/format";
import type { Member } from "@/lib/services/members";
import type { PageSearchMetrics, Plan } from "@/lib/services/plans";
import type { PageLookup } from "@/lib/services/seo";
import { BriefView } from "./brief-view";
import { PlanDialog } from "./plan-dialog";

const VIEW_OPTIONS = [
  { value: "table", label: "Table" },
  { value: "pipeline", label: "Pipeline" },
] as const;

const BRIEF_LABEL: Record<
  BriefStatus,
  { text: string; tone: "neutral" | "accent" | "good" | "bad" }
> = {
  none: { text: "No brief", tone: "neutral" },
  requested: { text: "Brief requested", tone: "accent" },
  ready: { text: "Brief ready", tone: "good" },
  failed: { text: "Brief failed", tone: "bad" },
};

interface Props {
  state: PlannerPageState;
  plans: Plan[];
  members: Member[];
  pages: PageLookup[];
  /** Search totals for linked pages, keyed by page id. */
  metrics: Record<number, PageSearchMetrics>;
  today: string;
}

export function PlannerView({ state, plans, members, pages, metrics, today }: Props) {
  const { navigate } = useFilterNavigation();
  const toast = useToast();
  const [editing, setEditing] = useState<Plan | "new" | null>(null);
  const [viewingBrief, setViewingBrief] = useState<Plan | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = Boolean(
    state.q || state.status || state.priority || state.page_type || state.owner_id,
  );
  const update = (changes: Partial<PlannerPageState>) =>
    navigate(plannerStateToParams({ ...state, ...changes }));

  function requestBrief(plan: Plan) {
    startTransition(async () => {
      const result = await requestBriefAction(plan.id);
      if (result.ok) {
        toast.success("Brief requested. Run `map briefs` to write it.");
      } else {
        toast.error(result.message);
      }
    });
  }

  function createTask(plan: Plan) {
    startTransition(async () => {
      const result = await createTaskFromPlanAction(plan.id);
      if (result.ok) toast.success(`Task created: ${result.data.title}`);
      else toast.error(result.message);
    });
  }

  function setStatus(plan: Plan, status: PlanStatus) {
    startTransition(async () => {
      const result = await savePlanAction(plan.id, { status });
      if (!result.ok) toast.error(result.message);
    });
  }

  /** The brief control changes with the brief's state: request, waiting, or view. */
  const briefControl = (plan: Plan) => {
    if (plan.brief_status === "ready" && plan.brief) {
      return (
        <Button variant="secondary" size="sm" onClick={() => setViewingBrief(plan)}>
          <FileText aria-hidden="true" className="size-3.5" />
          View brief
        </Button>
      );
    }
    if (plan.brief_status === "requested") {
      return (
        <Badge tone="accent" title="Run `map briefs` to write it">
          Brief requested
        </Badge>
      );
    }
    return (
      <Button variant="ghost" size="sm" disabled={isPending} onClick={() => requestBrief(plan)}>
        <Sparkles aria-hidden="true" className="size-3.5" />
        {plan.brief_status === "failed" ? "Retry AI brief" : "Request AI brief"}
      </Button>
    );
  };

  const rowActions = (plan: Plan) => (
    <span className="flex items-center justify-end gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={isPending}
        aria-label={`Create a task for ${plan.title}`}
        title="Create task"
        onClick={() => createTask(plan)}
      >
        <ListPlus aria-hidden="true" className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={`Edit ${plan.title}`}
        title="Edit plan"
        onClick={() => setEditing(plan)}
      >
        <Pencil aria-hidden="true" className="size-3.5" />
      </Button>
    </span>
  );

  const pageCell = (plan: Plan) => {
    if (!plan.page) {
      return <span className="text-ink-3">New page</span>;
    }
    const pageMetrics = metrics[plan.page.id];
    return (
      <span className="block min-w-0">
        <Link
          href={`/reports/seo?tab=queries&page_id=${plan.page.id}`}
          className="block truncate hover:text-accent-text hover:underline"
          title={plan.page.path}
        >
          {plan.page.path}
        </Link>
        <span className="num block text-xs text-ink-3">
          {pageMetrics
            ? `${formatCompact(pageMetrics.clicks)} clicks, position ${formatPosition(pageMetrics.position)}`
            : "No search data"}
        </span>
      </span>
    );
  };

  const dueCell = (plan: Plan) => {
    if (!plan.due_date) return <span className="text-ink-3">–</span>;
    const late = plan.status !== "published" && plan.due_date < today;
    return (
      <span className={cn("num whitespace-nowrap", late && "font-semibold text-bad-text")}>
        {formatDate(plan.due_date)}
        {late ? <span className="sr-only"> (overdue)</span> : null}
      </span>
    );
  };

  return (
    <>
      <div
        className="mb-3 flex flex-wrap items-center gap-2"
        role="search"
        aria-label="Plan filters"
      >
        <div className="w-56">
          <label htmlFor="plan-search" className="sr-only">
            Search plans
          </label>
          <Input
            id="plan-search"
            type="search"
            placeholder="Search title or keyword"
            defaultValue={state.q ?? ""}
            onKeyDown={(event) => {
              if (event.key === "Enter")
                update({ q: event.currentTarget.value.trim() || undefined });
            }}
            onBlur={(event) => {
              const value = event.currentTarget.value.trim() || undefined;
              if (value !== state.q) update({ q: value });
            }}
          />
        </div>
        {(
          [
            [
              "status",
              "Status",
              "All statuses",
              PLAN_STATUSES.map((s) => [s, PLAN_STATUS_LABELS[s]]),
            ],
            [
              "priority",
              "Priority",
              "All priorities",
              PRIORITIES.map((p) => [p, PRIORITY_LABELS[p]]),
            ],
            ["page_type", "Page type", "All page types", PAGE_TYPES.map((t) => [t, humanize(t)])],
            ["owner_id", "Owner", "All owners", members.map((m) => [String(m.id), m.name])],
          ] as const
        ).map(([key, label, placeholder, options]) => (
          <div key={key} className="w-40">
            <label htmlFor={`plan-${key}`} className="sr-only">
              {label}
            </label>
            <Select
              id={`plan-${key}`}
              value={String(state[key] ?? "")}
              onChange={(event) =>
                navigate(
                  plannerStateToParams({
                    ...state,
                    [key]: event.target.value || undefined,
                  } as Partial<PlannerPageState>),
                )
              }
            >
              <option value="">{placeholder}</option>
              {options.map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </Select>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Segmented
            label="Layout"
            options={VIEW_OPTIONS}
            value={state.view}
            onChange={(view) => update({ view })}
          />
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" className="size-4" />
            New plan
          </Button>
        </div>
      </div>

      {plans.length === 0 ? (
        <Panel>
          <EmptyState
            title={filtered ? "No plans match these filters" : "No plans yet"}
            action={
              <Button variant="primary" onClick={() => setEditing("new")}>
                Create a plan
              </Button>
            }
          >
            {filtered
              ? "Change or clear the filters above to see more plans."
              : "Plans track each page from idea to published. Add the first one to get started."}
          </EmptyState>
        </Panel>
      ) : state.view === "table" ? (
        <Panel className="overflow-hidden">
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Plan</Th>
                  <Th>Status</Th>
                  <Th>Priority</Th>
                  <Th>Owner</Th>
                  <Th>Existing page (28 days)</Th>
                  <Th align="right">Est. traffic</Th>
                  <Th align="right">Due</Th>
                  <Th>Brief</Th>
                  <Th align="right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.id} className="hover:bg-surface-2">
                    <Td className="max-w-60 min-w-48">
                      <button
                        type="button"
                        onClick={() => setEditing(plan)}
                        className="block max-w-full truncate text-left font-medium hover:text-accent-text hover:underline"
                        title={plan.title}
                      >
                        {plan.title}
                      </button>
                      <span className="block truncate text-xs text-ink-3">
                        {[
                          plan.target_keyword ?? "No target keyword",
                          humanize(plan.page_type),
                          plan.task_count > 0
                            ? `${plan.task_count} task${plan.task_count === 1 ? "" : "s"}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={plan.status === "published" ? "good" : "neutral"}>
                        {PLAN_STATUS_LABELS[plan.status]}
                      </Badge>
                    </Td>
                    <Td>
                      <PriorityLabel priority={plan.priority} />
                    </Td>
                    <Td>
                      {plan.owner ? (
                        <span className="flex items-center gap-1.5 whitespace-nowrap">
                          <Avatar name={plan.owner.name} color={plan.owner.color} />
                          {plan.owner.name.split(" ")[0]}
                        </span>
                      ) : (
                        <span className="text-ink-3">Unassigned</span>
                      )}
                    </Td>
                    <Td className="max-w-52">{pageCell(plan)}</Td>
                    <Td align="right">
                      {plan.est_monthly_traffic === null
                        ? "–"
                        : formatInteger(plan.est_monthly_traffic)}
                    </Td>
                    <Td align="right">{dueCell(plan)}</Td>
                    <Td className="whitespace-nowrap">{briefControl(plan)}</Td>
                    <Td align="right">{rowActions(plan)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Panel>
      ) : (
        <div className="scroll-thin overflow-x-auto pb-2">
          <div className="grid min-w-[1100px] grid-cols-6 gap-3">
            {PLAN_STATUSES.map((status) => {
              const column = plans.filter((plan) => plan.status === status);
              return (
                <section key={status} aria-labelledby={`plans-${status}`} className="min-w-0">
                  <h2
                    id={`plans-${status}`}
                    className="narrow mb-2 flex items-center justify-between px-1 text-base font-semibold"
                  >
                    {PLAN_STATUS_LABELS[status]}
                    <span className="num text-sm font-normal text-ink-3">{column.length}</span>
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {column.map((plan) => (
                      <li
                        key={plan.id}
                        className="rounded-lg border border-line bg-surface p-3 text-sm"
                      >
                        <button
                          type="button"
                          onClick={() => setEditing(plan)}
                          className="text-left font-medium hover:text-accent-text hover:underline"
                        >
                          {plan.title}
                        </button>
                        <p className="mt-0.5 truncate text-xs text-ink-3">
                          {plan.target_keyword ?? humanize(plan.page_type)}
                        </p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <PriorityLabel priority={plan.priority} />
                          <span className="flex items-center gap-1.5 text-xs">
                            {dueCell(plan)}
                            {plan.owner ? (
                              <Avatar name={plan.owner.name} color={plan.owner.color} />
                            ) : null}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
                          <Badge tone={BRIEF_LABEL[plan.brief_status].tone}>
                            {BRIEF_LABEL[plan.brief_status].text}
                          </Badge>
                          <span className="flex items-center gap-0.5">
                            {(
                              [
                                [-1, ChevronLeft, "back"],
                                [1, ChevronRight, "forward"],
                              ] as const
                            ).map(([step, Icon, direction]) => {
                              const target =
                                PLAN_STATUSES[PLAN_STATUSES.indexOf(plan.status) + step];
                              return (
                                <Button
                                  key={direction}
                                  variant="ghost"
                                  size="icon"
                                  className="size-6"
                                  disabled={isPending || !target}
                                  aria-label={
                                    target
                                      ? `Move ${plan.title} ${direction} to ${PLAN_STATUS_LABELS[target]}`
                                      : `Cannot move ${plan.title} ${direction}`
                                  }
                                  title={
                                    target
                                      ? `Move to ${PLAN_STATUS_LABELS[target].toLowerCase()}`
                                      : undefined
                                  }
                                  onClick={() => target && setStatus(plan, target)}
                                >
                                  <Icon aria-hidden="true" className="size-4" />
                                </Button>
                              );
                            })}
                          </span>
                        </div>
                      </li>
                    ))}
                    {column.length === 0 ? (
                      <li className="rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-xs text-ink-3">
                        Nothing here
                      </li>
                    ) : null}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {editing ? (
        <PlanDialog
          key={editing === "new" ? "new" : editing.id}
          plan={editing === "new" ? null : editing}
          members={members}
          pages={pages}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {viewingBrief?.brief ? (
        <Dialog
          open
          variant="panel"
          onOpenChange={(open) => {
            if (!open) setViewingBrief(null);
          }}
          title={viewingBrief.title}
          description="Content brief"
        >
          <BriefView brief={viewingBrief.brief} />
        </Dialog>
      ) : null}
    </>
  );
}
