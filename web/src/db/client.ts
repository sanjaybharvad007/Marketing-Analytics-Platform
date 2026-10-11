import type { SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

type Client = ReturnType<typeof postgres>;

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as typeof globalThis & { __mapSql?: Client };

function createClient(): Client {
  return postgres(env().DATABASE_URL, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {},
  });
}

export const client: Client = globalForDb.__mapSql ?? createClient();
if (process.env.NODE_ENV !== "production") {
  globalForDb.__mapSql = client;
}

export const db = drizzle(client, { schema });
export type Database = typeof db;
/** A transaction handle, accepted wherever `db` is. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Executor = Database | Transaction;

/**
 * Run a raw SQL statement and return its rows.
 *
 * The row type is asserted, not checked: every statement in the services
 * casts its columns explicitly (`::int`, `::float8`, `::text`) so the shape
 * that comes back is the shape declared here.
 */
export async function queryRows<Row>(statement: SQL, executor: Executor = db): Promise<Row[]> {
  const rows = await executor.execute(statement);
  return [...rows] as Row[];
}
