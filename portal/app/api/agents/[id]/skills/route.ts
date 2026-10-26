import { z } from "zod"

import { attachSkill } from "@/lib/fleet/ops"
import { route, slug, uuid } from "@/lib/fleet/server"

const Body = z.object({ repo_handle: z.string() })

export const POST = route<{ id: string }>({ mutate: true, builder: true }, async ({ req, fleet, params }) => {
  const { repo_handle } = Body.parse(await req.json())
  return attachSkill(fleet, uuid(params.id), slug(repo_handle, "skill"))
})
