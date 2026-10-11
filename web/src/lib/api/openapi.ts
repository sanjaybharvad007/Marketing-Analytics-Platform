/**
 * OpenAPI 3.1 description of the REST API, generated from the same Zod
 * schemas the handlers validate with. `openapi.test.ts` checks that every
 * route file and every documented operation match one to one.
 */
import { z } from "zod";
import {
  aiSummaryQuerySchema,
  auditRunsQuerySchema,
  opportunitiesQuerySchema,
  overviewQuerySchema,
  promptsQuerySchema,
  seoQuerySchema,
  timeseriesQuerySchema,
} from "./queries";
import {
  auditIngestSchema,
  briefPutSchema,
  issueListSchema,
  issuePatchSchema,
  planCreateSchema,
  planListSchema,
  planPatchSchema,
  runListSchema,
  taskCreateSchema,
  taskListSchema,
  taskPatchSchema,
  viewCreateSchema,
  viewListSchema,
} from "./schemas";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export interface Operation {
  method: HttpMethod;
  /** Path below /api/v1, with `{id}` placeholders. */
  path: string;
  tag: string;
  summary: string;
  query?: z.ZodObject;
  body?: z.ZodType;
  /** Status code of a successful response. */
  success?: 200 | 201 | 204;
  csv?: boolean;
}

export const OPERATIONS: Operation[] = [
  { method: "get", path: "/health", tag: "System", summary: "Service and database health" },
  {
    method: "get",
    path: "/openapi.json",
    tag: "System",
    summary: "This document",
  },
  {
    method: "get",
    path: "/metrics/overview",
    tag: "Metrics",
    summary: "KPIs for a period with the previous period for comparison",
    query: overviewQuerySchema,
  },
  {
    method: "get",
    path: "/metrics/timeseries",
    tag: "Metrics",
    summary: "Daily values of one KPI",
    query: timeseriesQuerySchema,
    csv: true,
  },
  {
    method: "get",
    path: "/seo/queries",
    tag: "SEO",
    summary: "Search queries with clicks, impressions, CTR and position",
    query: seoQuerySchema,
    csv: true,
  },
  {
    method: "get",
    path: "/seo/pages",
    tag: "SEO",
    summary: "Pages with search performance",
    query: seoQuerySchema,
    csv: true,
  },
  {
    method: "get",
    path: "/seo/keywords",
    tag: "SEO",
    summary: "Tracked keywords with current and previous rank",
    query: seoQuerySchema,
    csv: true,
  },
  {
    method: "get",
    path: "/seo/opportunities",
    tag: "SEO",
    summary: "Candidate striking-distance queries, decaying pages or AI-visibility gaps",
    query: opportunitiesQuerySchema,
  },
  {
    method: "get",
    path: "/ai-visibility/summary",
    tag: "AI visibility",
    summary: "Visibility score, mention and citation rates, share of voice",
    query: aiSummaryQuerySchema,
  },
  {
    method: "get",
    path: "/ai-visibility/prompts",
    tag: "AI visibility",
    summary: "Tracked prompts with per-engine status, or one prompt's stored answers",
    query: promptsQuerySchema,
  },
  {
    method: "get",
    path: "/plans",
    tag: "Plans",
    summary: "List content plans",
    query: planListSchema,
  },
  {
    method: "post",
    path: "/plans",
    tag: "Plans",
    summary: "Create a content plan (idempotent with dedupe_key)",
    body: planCreateSchema,
    success: 201,
  },
  { method: "get", path: "/plans/{id}", tag: "Plans", summary: "Get a content plan" },
  {
    method: "patch",
    path: "/plans/{id}",
    tag: "Plans",
    summary: "Update a content plan",
    body: planPatchSchema,
  },
  {
    method: "delete",
    path: "/plans/{id}",
    tag: "Plans",
    summary: "Delete a content plan",
    success: 204,
  },
  {
    method: "put",
    path: "/plans/{id}/brief",
    tag: "Plans",
    summary: "Store a generated brief or record that generation failed",
    body: briefPutSchema,
  },
  { method: "get", path: "/tasks", tag: "Tasks", summary: "List tasks", query: taskListSchema },
  {
    method: "post",
    path: "/tasks",
    tag: "Tasks",
    summary: "Create a task (idempotent with dedupe_key)",
    body: taskCreateSchema,
    success: 201,
  },
  { method: "get", path: "/tasks/{id}", tag: "Tasks", summary: "Get a task" },
  {
    method: "patch",
    path: "/tasks/{id}",
    tag: "Tasks",
    summary: "Update a task",
    body: taskPatchSchema,
  },
  { method: "delete", path: "/tasks/{id}", tag: "Tasks", summary: "Delete a task", success: 204 },
  {
    method: "get",
    path: "/audits",
    tag: "Audits",
    summary: "List audit runs, newest first",
    query: auditRunsQuerySchema,
  },
  {
    method: "post",
    path: "/audits",
    tag: "Audits",
    summary: "Ingest an audit run with its issues",
    body: auditIngestSchema,
    success: 201,
  },
  {
    method: "get",
    path: "/audits/latest",
    tag: "Audits",
    summary: "Latest run with open-issue counts by severity and rule",
  },
  {
    method: "get",
    path: "/audits/issues",
    tag: "Audits",
    summary: "Issues of a run (the latest by default)",
    query: issueListSchema.extend({ format: z.enum(["json", "csv"]).default("json") }),
    csv: true,
  },
  {
    method: "patch",
    path: "/audits/issues/{id}",
    tag: "Audits",
    summary: "Mark an issue open, ignored or fixed",
    body: issuePatchSchema,
  },
  {
    method: "get",
    path: "/pipelines/runs",
    tag: "Pipelines",
    summary: "Pipeline run history with freshness per source",
    query: runListSchema,
  },
  {
    method: "get",
    path: "/views",
    tag: "Saved views",
    summary: "List saved views",
    query: viewListSchema,
  },
  {
    method: "post",
    path: "/views",
    tag: "Saved views",
    summary: "Save a named filter set",
    body: viewCreateSchema,
    success: 201,
  },
  {
    method: "delete",
    path: "/views/{id}",
    tag: "Saved views",
    summary: "Delete a saved view",
    success: 204,
  },
];

type JsonSchema = Record<string, unknown>;

function jsonSchema(schema: z.ZodType): JsonSchema {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
  }) as JsonSchema;
  return rest;
}

function queryParameters(schema: z.ZodObject): JsonSchema[] {
  const document = jsonSchema(schema);
  const properties = (document.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((document.required as string[] | undefined) ?? []);
  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: "query",
    required: required.has(name),
    schema: property,
  }));
}

const ERROR_SCHEMA = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        details: {},
      },
    },
  },
};

const ENVELOPE_SCHEMA = {
  type: "object",
  required: ["data", "meta"],
  properties: { data: {}, meta: { type: "object" } },
};

const errorContent = { "application/json": { schema: { $ref: "#/components/schemas/Error" } } };

function operationObject(operation: Operation): JsonSchema {
  const isWrite = operation.method !== "get";
  const hasId = operation.path.includes("{id}");
  const success = operation.success ?? 200;
  const parameters: JsonSchema[] = [];
  if (hasId) {
    parameters.push({
      name: "id",
      in: "path",
      required: true,
      schema: { type: "integer", minimum: 1 },
    });
  }
  if (operation.query) parameters.push(...queryParameters(operation.query));

  const content: JsonSchema = {
    "application/json": { schema: { $ref: "#/components/schemas/Envelope" } },
  };
  if (operation.csv) content["text/csv"] = { schema: { type: "string" } };

  const responses: JsonSchema = {
    [String(success)]:
      success === 204 ? { description: "Deleted" } : { description: "Success", content },
  };
  if (operation.query || operation.body) {
    responses["400"] = { description: "Validation error", content: errorContent };
  }
  responses["401"] = { description: "Missing or invalid bearer token", content: errorContent };
  if (hasId) responses["404"] = { description: "Not found", content: errorContent };
  if (operation.method === "post") {
    responses["409"] = { description: "Conflict with an existing record", content: errorContent };
  }

  return {
    tags: [operation.tag],
    summary: operation.summary,
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(operation.body
      ? {
          requestBody: {
            required: true,
            content: { "application/json": { schema: jsonSchema(operation.body) } },
          },
        }
      : {}),
    responses,
    // Reads are open unless API_REQUIRE_TOKEN_FOR_READS is set; writes always need the token.
    security: isWrite ? [{ bearerAuth: [] }] : [{}, { bearerAuth: [] }],
  };
}

export function buildOpenApiDocument(): JsonSchema {
  const paths: Record<string, Record<string, JsonSchema>> = {};
  for (const operation of OPERATIONS) {
    (paths[operation.path] ??= {})[operation.method] = operationObject(operation);
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Marketing Analytics Platform API",
      version: "1.0.0",
      description:
        "Reporting, page planning, work management and audit ingestion. Successful responses " +
        "are wrapped as { data, meta }; errors as { error: { code, message, details } }.",
    },
    servers: [{ url: "/api/v1" }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      schemas: { Envelope: ENVELOPE_SCHEMA, Error: ERROR_SCHEMA },
    },
  };
}
