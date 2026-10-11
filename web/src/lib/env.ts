import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1).default("postgres://postgres:postgres@localhost:5432/marketing"),
  API_TOKEN: z.string().default(""),
  API_REQUIRE_TOKEN_FOR_READS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  BRAND_NAME: z.string().default("Northpeak Outfitters"),
  SITE_URL: z.string().default("https://www.northpeak.example"),
});

export type Env = z.infer<typeof schema>;
type EnvKey = keyof Env;

const KEYS = Object.keys(schema.shape) as EnvKey[];

/**
 * The repository keeps one .env at its root, shared with the Python
 * pipelines. Next.js only reads env files next to the app, so the root file
 * is read here, once. It is absent in Docker and CI, where real environment
 * variables are used instead.
 */
let rootFile: Record<string, string | undefined> | undefined;

function rootEnvFile(): Record<string, string | undefined> {
  if (rootFile === undefined) {
    try {
      rootFile = parseEnv(readFileSync(path.join(process.cwd(), "..", ".env"), "utf8"));
    } catch {
      rootFile = {};
    }
  }
  return rootFile;
}

/**
 * Server-side configuration. Real environment variables take precedence over
 * the root .env file. Read lazily so `next build` needs no environment.
 */
export function env(): Env {
  const file = rootEnvFile();
  const values = Object.fromEntries(
    KEYS.map((key) => [key, process.env[key] || file[key] || undefined]),
  );
  return schema.parse(values);
}
