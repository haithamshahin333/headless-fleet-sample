import { z } from "zod"

import { createThread, listThreads } from "@/lib/fleet/ops"
import { PortalError, route, uuid } from "@/lib/fleet/server"

type P = { id: string }

/** YOUR conversations with this agent. Fleet scopes the list to the caller. */
export const GET = route<P>({}, async ({ req, fleet, params }) => {
  const sp = req.nextUrl.searchParams
  const cursor = sp.get("cursor") ?? undefined
  if (cursor && cursor.length > 500) throw new PortalError(400, "bad cursor")
  return listThreads(fleet, { agentId: uuid(params.id), cursor, testRun: sp.get("test_run") === "true" })
})

const Body = z.object({ test_run: z.boolean().optional() })

/** `test_run` threads (the Build pane) stay out of usage analytics and Use history. */
export const POST = route<P>({ mutate: true }, async ({ req, fleet, params }) => {
  const { test_run } = Body.parse(await req.json().catch(() => ({})))
  return { thread_id: await createThread(fleet, uuid(params.id), !!test_run) }
})
