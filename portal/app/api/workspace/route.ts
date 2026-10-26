import { cookies } from "next/headers"
import { z } from "zod"

import { PortalError, route, workspacesFor } from "@/lib/fleet/server"

const Body = z.object({ workspace_id: z.string().uuid() })

/**
 * Switch workspace — only to one LangSmith lists for THIS user. `secure` follows the public
 * URL: behind a TLS-terminating ingress the request itself arrives as http.
 */
export const POST = route({ mutate: true, workspace: false }, async ({ req, user }) => {
  const { workspace_id } = Body.parse(await req.json())
  const all = await workspacesFor(user)
  if (!all.some((w) => w.id === workspace_id)) throw new PortalError(403, "Not one of your workspaces.")
  ;(await cookies()).set("ws", workspace_id, { httpOnly: true, sameSite: "lax", path: "/", secure: (process.env.AUTH_URL ?? req.url).startsWith("https:") })
  return { ok: true }
})
