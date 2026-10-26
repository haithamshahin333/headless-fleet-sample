import { assertSafeComputer } from "@/lib/fleet/computer-access"
import { createAgent, listAgents } from "@/lib/fleet/ops"
import { CreateAgent } from "@/lib/fleet/schemas"
import { route } from "@/lib/fleet/server"

/**
 * The agents this user can see, exactly as Fleet resolves them: `audience=user` (owned +
 * shared directly with you) and `audience=tenant` (published to the workspace). Each
 * item carries Fleet's caller-relative `is_owner` and `access_level`.
 */
export const GET = route({}, async ({ fleet }) => {
  const [mine, published] = await Promise.all([listAgents(fleet, "user"), listAgents(fleet, "tenant")])
  const seen = new Set(mine.map((a) => a.id))
  return {
    owned: mine.filter((a) => a.is_owner),
    shared: mine.filter((a) => !a.is_owner),
    published: published.filter((a) => !seen.has(a.id)),
  }
})

/** One full-spec create — the agent is born with its tools, skills, subagents, computer. */
export const POST = route({ mutate: true, builder: true }, async ({ req, fleet }) => {
  const spec = CreateAgent.parse(await req.json())
  await assertSafeComputer(fleet, spec.backend)
  return createAgent(fleet, spec)
})
