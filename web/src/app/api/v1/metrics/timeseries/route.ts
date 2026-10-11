import { csvResponse, rounded, toCsv } from "@/lib/api/csv";
import { ok } from "@/lib/api/envelope";
import { parseWith, route, wantsCsv } from "@/lib/api/handler";
import { resolveQueryPeriods } from "@/lib/api/periods";
import { timeseriesQuerySchema } from "@/lib/api/queries";
import { getOverview } from "@/lib/services/overview";

export const dynamic = "force-dynamic";

export const GET = route(async ({ query }) => {
  const parsed = parseWith(timeseriesQuerySchema, query);
  const periods = await resolveQueryPeriods(parsed, query);
  const overview = await getOverview(periods);
  const points = overview.series.map((day) => ({ date: day.date, value: day[parsed.metric] }));
  const previous =
    overview.previousSeries?.map((day) => ({ date: day.date, value: day[parsed.metric] })) ?? null;

  if (wantsCsv(query)) {
    const rows = points.map((point, index) => ({ ...point, previous: previous?.[index] }));
    const csv = toCsv(
      [
        { header: "date", value: (row) => row.date },
        { header: parsed.metric, value: (row) => rounded(row.value, 4) },
        { header: "previous_date", value: (row) => row.previous?.date },
        { header: `previous_${parsed.metric}`, value: (row) => rounded(row.previous?.value, 4) },
      ],
      rows,
    );
    return csvResponse(`${parsed.metric}-${overview.range.from}-${overview.range.to}.csv`, csv);
  }
  return ok({
    metric: parsed.metric,
    range: overview.range,
    compare: overview.compare,
    points,
    previous,
  });
});
