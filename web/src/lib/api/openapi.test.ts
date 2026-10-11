import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument, OPERATIONS } from "./openapi";

const API_ROOT = path.join(import.meta.dirname, "../../app/api/v1");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** Every `METHOD /path` implemented by a route.ts file under app/api/v1. */
function implementedOperations(dir = API_ROOT): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...implementedOperations(full));
    } else if (entry === "route.ts") {
      const source = readFileSync(full, "utf8");
      const route = `/${path.relative(API_ROOT, dir).split(path.sep).join("/")}`.replace(
        /\[(\w+)\]/g,
        "{$1}",
      );
      for (const method of METHODS) {
        if (new RegExp(`export const ${method}\\b`).test(source)) found.push(`${method} ${route}`);
      }
    }
  }
  return found.sort();
}

describe("OpenAPI document", () => {
  const document = buildOpenApiDocument() as {
    openapi: string;
    paths: Record<
      string,
      Record<
        string,
        {
          parameters?: Array<{ name: string; in: string }>;
          requestBody?: unknown;
          security: unknown[];
          responses: Record<string, unknown>;
        }
      >
    >;
  };

  it("documents exactly the operations the route files implement", () => {
    const documented = OPERATIONS.map((op) => `${op.method.toUpperCase()} ${op.path}`).sort();
    expect(documented).toEqual(implementedOperations());
  });

  it("has no duplicate operations", () => {
    const keys = OPERATIONS.map((op) => `${op.method} ${op.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is an OpenAPI 3.1 document with every path present", () => {
    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths).sort()).toEqual(
      [...new Set(OPERATIONS.map((op) => op.path))].sort(),
    );
  });

  it("requires the bearer token on every write and allows anonymous reads", () => {
    for (const [route, methods] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        const anonymous = operation.security.some(
          (entry) => Object.keys(entry as object).length === 0,
        );
        expect(anonymous, `${method} ${route}`).toBe(method === "get");
        expect(operation.responses["401"], `${method} ${route}`).toBeDefined();
      }
    }
  });

  it("derives query parameters from the Zod schemas", () => {
    const names =
      document.paths["/seo/queries"]?.get?.parameters?.map((parameter) => parameter.name) ?? [];
    for (const expected of [
      "range",
      "country",
      "device",
      "brand",
      "position",
      "q",
      "q_not",
      "min_impressions",
      "sort",
      "page",
      "format",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("declares the id path parameter and request bodies", () => {
    const patch = document.paths["/tasks/{id}"]?.patch;
    expect(patch?.parameters?.[0]).toMatchObject({ name: "id", in: "path" });
    expect(patch?.requestBody).toBeDefined();
    expect(document.paths["/tasks/{id}"]?.delete?.responses["204"]).toBeDefined();
    expect(document.paths["/tasks"]?.post?.responses["201"]).toBeDefined();
  });

  it("serialises to JSON", () => {
    expect(() => JSON.stringify(document)).not.toThrow();
  });
});
