import { sendMessage } from "@/lib/fleet/ops"
import { SendMessage } from "@/lib/fleet/schemas"
import { errorResponse, route, uuid } from "@/lib/fleet/server"
import { sseResponse } from "@/lib/fleet/sse"

export const dynamic = "force-dynamic"

/** Stream one turn. Fleet enforces run access, tool reach, model and spend per user. */
export const POST = route<{ tid: string }>({ mutate: true }, async ({ req, fleet, params }) => {
  const tid = uuid(params.tid, "thread id")
  const body = SendMessage.parse(await req.json())
  return sseResponse(
    fleet,
    tid,
    (signal) => sendMessage(fleet, tid, body.agent_id, body.text, undefined, signal),
    async (err) => errorResponse(err).json(),
  )
})
