import { classifyConnection, startConnection } from "@/lib/fleet/ops"
import { Connect } from "@/lib/fleet/schemas"
import { route } from "@/lib/fleet/server"

/**
 * Start (or silently refresh) YOUR connection to a provider — the on-behalf-of step.
 * `REUSE` often completes with no consent screen; otherwise the browser opens
 * `verification_url` in a popup and polls `/api/connect/{session}`.
 */
export const POST = route({ mutate: true }, async ({ req, fleet }) => {
  const { provider_slug, scopes } = Connect.parse(await req.json())
  const s = await startConnection(fleet, provider_slug, scopes)
  const url = (s.verification_url as string | undefined) ?? null
  return {
    state: url ? "pending" : classifyConnection(s.status ?? "completed"),
    session_id: (s.id as string | undefined) ?? null,
    verification_url: url,
    provider_slug,
  }
})
