import { route } from "@/lib/api/handler";
import { buildOpenApiDocument } from "@/lib/api/openapi";

export const dynamic = "force-dynamic";

export const GET = route(() => Response.json(buildOpenApiDocument()));
