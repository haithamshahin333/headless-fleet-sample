import { ensureGraphProfile } from "@/lib/fleet/computer-access"
import { route } from "@/lib/fleet/server"

/**
 * Build > Computer: reuse or create the CALLER's own Microsoft Graph access profile.
 * No request body: the profile config is fixed server-side, and it is created as the
 * signed-in user only (profiles are user-scoped in LangSmith).
 */
export const POST = route({ mutate: true, builder: true }, async ({ fleet }) => {
  const p = await ensureGraphProfile(fleet)
  return { id: p.id, name: p.name, created: p.created, graph: true, acts_as_user: true }
})
