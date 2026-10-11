/**
 * Helpers for tests that need PostgreSQL.
 *
 * Set TEST_DATABASE_URL to a database that may be wiped: `resetDatabase`
 * drops its public schema and re-applies db/migrations. Without the variable
 * these suites are skipped.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { describe } from "vitest";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
export const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

const MIGRATIONS_DIR = path.join(import.meta.dirname, "../../../db/migrations");

export async function resetDatabase(): Promise<void> {
  const admin = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const file of files) {
      await admin.unsafe(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    }
  } finally {
    await admin.end();
  }
}
