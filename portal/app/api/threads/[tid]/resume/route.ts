import { resumeRun } from "@/lib/fleet/ops"
import { ResumeBody } from "@/lib/fleet/schemas"
import { errorResponse, route, uuid } from "@/lib/fleet/server"
import { sseResponse } from "@/lib/fleet/sse"

export const dynamic = "force-dynamic"

/**
 * Answer an interrupt and let the run continue: a tool approval
 * (`approve|reject|respond`) or an auth pause (`continue` after connecting, or `skip`).
 */
export const POST = route<{ tid: string }>({ mutate: true }, async ({ req, fleet, params }) => {
  const tid = uuid(params.tid, "thread id")
  const body = ResumeBody.parse(await req.json())
  const r = body.kind === "approval" ? { kind: "approval" as const, decision: body.decision, message: body.message } : { kind: "auth" as const, action: body.action }
  return sseResponse(
    fleet,
    tid,
    (signal) => resumeRun(fleet, tid, body.agent_id, r, signal),
    async (err) => errorResponse(err).json(),
  )
})
