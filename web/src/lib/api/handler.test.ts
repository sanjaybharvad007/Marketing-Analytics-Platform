import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { created, noContent, ok, pageMeta } from "./envelope";
import { conflict, notFound } from "./errors";
import { idParam, parseWith, readJson, route } from "./handler";

const params = { params: Promise.resolve({}) };

function request(path: string, init: { method?: string; token?: string; body?: string } = {}) {
  const headers = new Headers();
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  if (init.body) headers.set("content-type", "application/json");
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  });
}

beforeEach(() => {
  vi.stubEnv("API_TOKEN", "test-token");
  vi.stubEnv("API_REQUIRE_TOKEN_FOR_READS", "false");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("envelope", () => {
  it("wraps data and meta", async () => {
    const response = ok([{ id: 1 }], pageMeta(41, 2, 20));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [{ id: 1 }],
      meta: { page: 2, page_size: 20, total: 41, total_pages: 3 },
    });
  });

  it("uses 201 for created and 204 with no body for deletes", async () => {
    expect(created({ id: 1 }).status).toBe(201);
    const empty = noContent();
    expect(empty.status).toBe(204);
    expect(await empty.text()).toBe("");
  });

  it("reports at least one page for an empty collection", () => {
    expect(pageMeta(0, 1, 25).total_pages).toBe(1);
  });
});

describe("route", () => {
  it("passes normalised query params to the handler", async () => {
    const handler = route(({ query }) => ok(query));
    const response = await handler(request("/api/v1/x?country=US&country=CA&q="), params);
    expect((await response.json()).data).toEqual({ country: "US,CA" });
  });

  it("rejects writes without a valid token using the error envelope", async () => {
    const handler = route(() => ok("should not run"));
    for (const token of [undefined, "wrong"]) {
      const response = await handler(request("/api/v1/x", { method: "POST", token }), params);
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe('Bearer realm="api"');
      expect(await response.json()).toEqual({
        error: { code: "unauthorized", message: "A valid bearer token is required." },
      });
    }
  });

  it("accepts writes with the token", async () => {
    const handler = route(() => created({ id: 7 }));
    const response = await handler(
      request("/api/v1/x", { method: "POST", token: "test-token" }),
      params,
    );
    expect(response.status).toBe(201);
  });

  it("requires the token for reads when API_REQUIRE_TOKEN_FOR_READS is true", async () => {
    vi.stubEnv("API_REQUIRE_TOKEN_FOR_READS", "true");
    const handler = route(() => ok(1));
    expect((await handler(request("/api/v1/x"), params)).status).toBe(401);
    expect((await handler(request("/api/v1/x", { token: "test-token" }), params)).status).toBe(200);
  });

  it("turns thrown API errors into responses", async () => {
    const missing = await route(() => {
      throw notFound("Plan");
    })(request("/api/v1/plans/9"), params);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toEqual({
      code: "not_found",
      message: "Plan was not found.",
    });

    const duplicate = await route(() => {
      throw conflict("Already exists.");
    })(request("/api/v1/views"), params);
    expect(duplicate.status).toBe(409);
  });

  it("maps database constraint violations to client errors", async () => {
    const unique = Object.assign(new Error("duplicate key"), { code: "23505" });
    const wrapped = new Error("query failed", {
      cause: Object.assign(new Error("fk"), { code: "23503" }),
    });
    expect((await route(() => Promise.reject(unique))(request("/x"), params)).status).toBe(409);
    expect((await route(() => Promise.reject(wrapped))(request("/x"), params)).status).toBe(400);
  });

  it("hides unexpected errors behind a generic 500", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await route(() => {
      throw new Error("connection string postgres://user:pw@host leaked");
    })(request("/x"), params);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "internal_error", message: "An unexpected error occurred." },
    });
    expect(logged).toHaveBeenCalledOnce();
  });
});

describe("input parsing", () => {
  const schema = z.object({
    title: z.string().min(1),
    priority: z.enum(["low", "high"]).default("low"),
  });

  it("returns parsed data with defaults", () => {
    expect(parseWith(schema, { title: "x" })).toEqual({ title: "x", priority: "low" });
  });

  it("reports each invalid field", async () => {
    const response = await route(() => ok(parseWith(schema, { title: "", priority: "urgent" })))(
      request("/x"),
      params,
    );
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("validation_error");
    expect(body.error.details.map((detail: { path: string }) => detail.path)).toEqual([
      "title",
      "priority",
    ]);
  });

  it("rejects a body that is not JSON", async () => {
    const handler = route(async ({ request: incoming }) => ok(await readJson(incoming, schema)));
    const response = await handler(
      request("/x", { method: "POST", token: "test-token", body: "{not json" }),
      params,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe("The request body is not valid JSON.");
  });

  it("parses a valid JSON body", async () => {
    const handler = route(async ({ request: incoming }) => ok(await readJson(incoming, schema)));
    const response = await handler(
      request("/x", {
        method: "POST",
        token: "test-token",
        body: JSON.stringify({ title: "Plan" }),
      }),
      params,
    );
    expect((await response.json()).data).toEqual({ title: "Plan", priority: "low" });
  });

  it("treats non-numeric ids as not found", () => {
    expect(idParam("42", "Task")).toBe(42);
    for (const bad of ["0", "-1", "1.5", "abc", "1e3", "99999999999", ""]) {
      expect(() => idParam(bad, "Task")).toThrow("Task was not found.");
    }
  });
});
