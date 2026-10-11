import { FilterScope, PendingRegion } from "@/components/shell/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { WorkView } from "@/components/work/work-view";
import type { RawParams } from "@/lib/filters/params";
import { parseWorkState } from "@/lib/filters/work";
import { listMembers } from "@/lib/services/members";
import { listPlans } from "@/lib/services/plans";
import { listLabels, listTasks } from "@/lib/services/tasks";

export const dynamic = "force-dynamic";
export const metadata = { title: "Work" };

export default async function WorkPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const state = parseWorkState(await searchParams);
  const [{ rows: tasks }, members, { rows: plans }, labels] = await Promise.all([
    listTasks({
      assignee_id: state.assignee_id,
      priority: state.priority,
      label: state.label,
      source: state.source,
      due: state.due,
      page: 1,
      page_size: 500,
    }),
    listMembers(),
    listPlans({ page: 1, page_size: 200 }),
    listLabels(),
  ]);
  const overdue = tasks.filter((task) => task.overdue).length;

  return (
    <FilterScope>
      <PageHeader
        title="Work"
        description={`${tasks.length} task${tasks.length === 1 ? "" : "s"}${overdue > 0 ? `, ${overdue} overdue` : ""}. Drag a card to change its status or priority order.`}
      />
      <PendingRegion>
        <WorkView
          state={state}
          tasks={tasks}
          members={members}
          plans={plans.map((plan) => ({ id: plan.id, title: plan.title }))}
          labels={labels}
        />
      </PendingRegion>
    </FilterScope>
  );
}
