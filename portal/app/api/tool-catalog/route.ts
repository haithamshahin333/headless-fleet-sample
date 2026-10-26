import { toolCatalog } from "@/lib/fleet/ops"
import { route, uuid } from "@/lib/fleet/server"

/** Tools on ONE registered integration. No arbitrary-URL form (SSRF hygiene). */
export const GET = route({}, async ({ req, fleet }) => toolCatalog(fleet, uuid(req.nextUrl.searchParams.get("integration_id") ?? undefined, "integration id")))
