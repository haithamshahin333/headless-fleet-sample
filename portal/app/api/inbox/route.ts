import { listThreads, threadCount } from "@/lib/fleet/ops"
import { PortalError, route } from "@/lib/fleet/server"

/** Your recent conversations across every agent, plus Fleet's attention count. */
export const GET = route({}, async ({ req, fleet }) => {
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined
  if (cursor && cursor.length > 500) throw new PortalError(400, "bad cursor")
  const [page, count] = await Promise.all([listThreads(fleet, { cursor }), threadCount(fleet).catch(() => ({ attention_count: undefined }))])
  return { ...page, attention_count: count.attention_count ?? null }
})
