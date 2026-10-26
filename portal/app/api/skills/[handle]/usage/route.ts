import { skillUsage } from "@/lib/fleet/ops"
import { route, skillHandle } from "@/lib/fleet/server"

/** Agents the caller can see that link this skill, and which of them the caller can edit. */
export const GET = route<{ handle: string }>({ builder: true }, async ({ fleet, params }) =>
  skillUsage(fleet, skillHandle(decodeURIComponent(params.handle))),
)
