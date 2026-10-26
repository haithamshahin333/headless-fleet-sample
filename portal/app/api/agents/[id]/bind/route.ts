import { z } from "zod"

import { bindForSharedAgent } from "@/lib/fleet/ops"
import { route, slug, uuid } from "@/lib/fleet/server"

const Body = z.object({ provider_slug: z.string() })

/**
 * Bind the caller's connection to a SHARED-identity agent ("Use this agent's
 * connections"). Owner/editor only — Fleet enforces it. Personal agents never need this.
 */
export const POST = route<{ id: string }>({ mutate: true }, async ({ req, fleet, params }) => {
  const { provider_slug } = Body.parse(await req.json())
  return { bound: await bindForSharedAgent(fleet, uuid(params.id), slug(provider_slug, "provider")) }
})
