import { activityFor, clearActivity } from "@/lib/fleet/core"
import { config, route } from "@/lib/fleet/server"
import { DEV_LOGIN } from "@/lib/config"

/** YOUR Fleet calls only, already redacted (your token never appears). */
export const GET = route({ workspace: false }, async ({ req, user }) => {
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 80) || 80, 150)
  return { base_url: config.baseUrl, auth_mode: DEV_LOGIN ? "dev: shared API key" : "OIDC bearer (your sign-in token)", items: activityFor(user.uid, limit) }
})

export const DELETE = route({ mutate: true, workspace: false }, async ({ user }) => {
  clearActivity(user.uid)
  return { ok: true }
})
