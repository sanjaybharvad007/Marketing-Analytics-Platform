/**
 * Fails when src/db/schema.ts and the SQL migrations disagree about a table,
 * a column, its type or its nullability.
 */
import { getTableName, sql } from "drizzle-orm";
import { getMaterializedViewConfig, getTableConfig, type PgColumn } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb, resetDatabase } from "@/test/database";
import { ROLLUPS, TABLES } from "./schema";

interface ColumnInfo {
  type: string;
  notNull: boolean;
}

/** Drizzle and Postgres spell a few types differently; reduce both to one form. */
function normalizeType(type: string): string {
  return type
    .toLowerCase()
    .replace(/\s*,\s*/g, ",")
    .replace(/^char\(/, "character(")
    .replace(/^bpchar\(/, "character(")
    .trim();
}

function declared(columns: PgColumn[]): Record<string, ColumnInfo> {
  return Object.fromEntries(
    columns.map((column) => [
      column.name,
      { type: normalizeType(column.getSQLType()), notNull: column.notNull },
    ]),
  );
}

describeDb("Drizzle schema matches the migrated database", () => {
  let live: Map<string, { kind: string; columns: Record<string, ColumnInfo> }>;

  beforeAll(async () => {
    await resetDatabase();
    const { db } = await import("./client");
    const rows = await db.execute<{
      relation: string;
      kind: string;
      column_name: string;
      type: string;
      not_null: boolean;
    }>(sql`
      SELECT c.relname AS relation, c.relkind::text AS kind, a.attname AS column_name,
             format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'm')
        AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY c.relname, a.attnum
    `);
    live = new Map();
    for (const row of rows) {
      const entry = live.get(row.relation) ?? { kind: row.kind, columns: {} };
      entry.columns[row.column_name] = { type: normalizeType(row.type), notNull: row.not_null };
      live.set(row.relation, entry);
    }
  });

  afterAll(async () => {
    const { client } = await import("./client");
    await client.end();
  });

  it("declares every table and rollup that the migrations create, and no others", () => {
    const tables = Object.values(TABLES).map((table) => getTableName(table));
    const views = Object.values(ROLLUPS).map((view) => getMaterializedViewConfig(view).name);
    const liveTables = [...live].filter(([, entry]) => entry.kind === "r").map(([name]) => name);
    const liveViews = [...live].filter(([, entry]) => entry.kind === "m").map(([name]) => name);
    // schema_migrations belongs to the migration runner, not to the app.
    expect(tables.sort()).toEqual(liveTables.filter((name) => name !== "schema_migrations").sort());
    expect(views.sort()).toEqual(liveViews.sort());
  });

  it.each(Object.values(TABLES).map((table) => [getTableName(table), table] as const))(
    "table %s has the same columns, types and nullability",
    (name, table) => {
      expect(declared(getTableConfig(table).columns)).toEqual(live.get(name)?.columns);
    },
  );

  it.each(
    Object.values(ROLLUPS).map((view) => [getMaterializedViewConfig(view).name, view] as const),
  )("rollup %s has the same columns and types", (name, view) => {
    const columns = Object.values(getMaterializedViewConfig(view).selectedFields) as PgColumn[];
    const expected = Object.fromEntries(
      Object.entries(declared(columns)).map(([column, info]) => [column, info.type]),
    );
    const actual = Object.fromEntries(
      Object.entries(live.get(name)?.columns ?? {}).map(([column, info]) => [column, info.type]),
    );
    // Postgres does not track NOT NULL on materialized view columns, so only names and types are compared.
    expect(expected).toEqual(actual);
  });
});
