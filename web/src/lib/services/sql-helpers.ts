/** Small SQL fragments reused by the resource services. */
import { type SQL, sql } from "drizzle-orm";

/** A timestamptz column rendered as an ISO 8601 UTC string. */
export function isoTimestamp(column: SQL): SQL {
  return sql`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

export function limitOffset(page: number, pageSize: number): SQL {
  return sql`LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
}

export interface Listed<Row> {
  rows: Row[];
  total: number;
}

/** Split the `total` window-count column off a page of rows. */
export function splitTotal<R extends { total: number }>(
  rows: ReadonlyArray<R>,
): Listed<Omit<R, "total">> {
  return {
    total: rows[0]?.total ?? 0,
    rows: rows.map(({ total: _total, ...row }) => row),
  };
}
