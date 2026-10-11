import { PlannerView } from "@/components/planner/planner-view";
import { FilterScope, PendingRegion } from "@/components/shell/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { addDays } from "@/lib/dates";
import type { RawParams } from "@/lib/filters/params";
import { parsePlannerState } from "@/lib/filters/planner";
import { listMembers } from "@/lib/services/members";
import { getDataAnchor, getToday } from "@/lib/services/meta";
import { getPageSearchMetrics, listPlans } from "@/lib/services/plans";
import { listPageOptions } from "@/lib/services/seo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Planner" };

export default async function PlannerPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const state = parsePlannerState(await searchParams);
  const [{ rows: plans }, members, pages, anchor, today] = await Promise.all([
    listPlans({ ...state, page: 1, page_size: 200 }),
    listMembers(),
    listPageOptions(),
    getDataAnchor(),
    getToday(),
  ]);
  const linkedPages = [...new Set(plans.flatMap((plan) => (plan.page_id ? [plan.page_id] : [])))];
  const metrics = await getPageSearchMetrics(linkedPages, {
    from: addDays(anchor, -27),
    to: anchor,
  });

  return (
    <FilterScope>
      <PageHeader
        title="Planner"
        description="Pages to create or refresh. Request a brief and the briefs script fills it in from search data."
      />
      <PendingRegion>
        <PlannerView
          state={state}
          plans={plans}
          members={members}
          pages={pages}
          metrics={Object.fromEntries(metrics)}
          today={today}
        />
      </PendingRegion>
    </FilterScope>
  );
}
