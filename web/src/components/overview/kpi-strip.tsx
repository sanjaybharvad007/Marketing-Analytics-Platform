import { Sparkline } from "@/components/charts/sparkline";
import { DeltaLabel } from "@/components/ui/delta";
import { Panel } from "@/components/ui/panel";
import { formatMetric } from "@/lib/format";
import { KPI_KEYS, KPI_SPECS } from "@/lib/metrics";
import type { Overview } from "@/lib/services/overview";

/**
 * The headline numbers as one ruled sheet rather than eight separate cards:
 * they are read together, so they share a surface.
 */
export function KpiStrip({ overview }: { overview: Overview }) {
  const compared = overview.compare !== null;
  return (
    <Panel aria-label="Key metrics" className="overflow-hidden">
      <dl className="grid grid-cols-2 md:grid-cols-4">
        {KPI_KEYS.map((key, index) => {
          const spec = KPI_SPECS[key];
          const { value, previous } = overview.kpis[key];
          return (
            <div
              key={key}
              title={spec.description}
              className={[
                "flex min-w-0 flex-col gap-1 border-line px-4 pt-3 pb-2",
                index % 2 === 1 ? "border-l" : "",
                index % 4 !== 0 ? "md:border-l" : "md:border-l-0",
                index >= 2 ? "border-t" : "",
                index >= 4 ? "md:border-t" : "md:border-t-0",
              ].join(" ")}
            >
              <dt className="truncate text-sm text-ink-2">{spec.label}</dt>
              <dd className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="narrow text-2xl leading-8 font-semibold text-ink">
                  {formatMetric(value, spec.format)}
                </span>
                {compared ? (
                  <DeltaLabel
                    current={value}
                    previous={previous}
                    format={spec.format}
                    higherIsBetter={spec.higherIsBetter}
                    className="text-sm"
                  />
                ) : null}
              </dd>
              <dd className="mt-auto">
                <Sparkline values={overview.series.map((day) => day[key])} className="h-7 w-full" />
              </dd>
            </div>
          );
        })}
      </dl>
    </Panel>
  );
}
