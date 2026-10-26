import { classifyConnection, pollConnection } from "@/lib/fleet/ops"
import { PortalError, route } from "@/lib/fleet/server"

/** Long-poll an auth session (the server holds the request up to ~25s). */
export const GET = route<{ sid: string }>({}, async ({ fleet, params }) => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(params.sid)) throw new PortalError(400, "invalid session id")
  const s = await pollConnection(fleet, params.sid, 25)
  return { state: classifyConnection(s.status), session_id: params.sid }
})
