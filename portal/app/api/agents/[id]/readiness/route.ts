import { computerAccess } from "@/lib/fleet/computer-access"
import { getAgent } from "@/lib/fleet/ops"
import { readiness } from "@/lib/fleet/readiness"
import { route, uuid } from "@/lib/fleet/server"

type Obj = Record<string, unknown>

/** Pre-flight: does THIS user have the OAuth connections this agent needs, and can its computer reach Graph as them? */
export const GET = route<{ id: string }>({}, async ({ fleet, params }) => {
  const agent = await getAgent(fleet, uuid(params.id))
  const ints = await fleet.get<{ items?: Obj[] }>("/v1/fleet/integrations", { page_size: 100 }).catch(() => ({ items: [] as Obj[] }))
  const [r, computer] = await Promise.all([
    readiness(fleet, agent, ints.items ?? []),
    computerAccess(fleet, agent).catch(() => null), // informational: never blocks the chat
  ])
  return { ...r, computer }
})
