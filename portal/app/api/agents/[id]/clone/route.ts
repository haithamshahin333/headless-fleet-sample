import { z } from "zod"

import { cloneAgent } from "@/lib/fleet/ops"
import { route, uuid } from "@/lib/fleet/server"

const Body = z.object({ name: z.string().min(1).max(120) })

/** Clone = read access is enough; the copy is yours (private by default). */
export const POST = route<{ id: string }>({ mutate: true, builder: true }, async ({ req, fleet, params }) => {
  const { name } = Body.parse(await req.json())
  return cloneAgent(fleet, uuid(params.id), name)
})
