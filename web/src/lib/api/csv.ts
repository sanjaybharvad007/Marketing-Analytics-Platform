/** CSV serialisation (RFC 4180) for report exports. */

export interface CsvColumn<Row> {
  header: string;
  value: (row: Row) => string | number | boolean | null | undefined;
}

const NEEDS_QUOTES = /[",\r\n]/;
// A leading =, +, - or @ makes spreadsheet apps evaluate a text cell as a formula.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv<Row>(
  columns: ReadonlyArray<CsvColumn<Row>>,
  rows: ReadonlyArray<Row>,
): string {
  const lines = [columns.map((column) => csvCell(column.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(column.value(row))).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function csvResponse(filename: string, body: string): Response {
  const safeName = filename.replace(/[^A-Za-z0-9._-]+/g, "-");
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Round to a fixed number of decimals for export, keeping null as empty. */
export function rounded(value: number | null | undefined, digits: number): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
