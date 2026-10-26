import { assertSafeComputer } from "@/lib/fleet/computer-access"
import { deleteAgent, getAgent, setBackend, setInstructions, setModel, setTools, updateAgent } from "@/lib/fleet/ops"
import { PatchAgent } from "@/lib/fleet/schemas"
import { route, uuid } from "@/lib/fleet/server"

type P = { id: string }

export const GET = route<P>({}, async ({ fleet, params }) => getAgent(fleet, uuid(params.id)))

/** One section per call; Fleet enforces write access (403 otherwise). */
export const PATCH = route<P>({ mutate: true, builder: true }, async ({ req, fleet, params }) => {
  const id = uuid(params.id)
  const body = PatchAgent.parse(await req.json())
  switch (body.op) {
    case "meta":
      return updateAgent(fleet, id, { name: body.name, description: body.description }, "rename")
    case "instructions":
      return setInstructions(fleet, id, body.system_prompt)
    case "model":
      return setModel(fleet, id, body.model_id)
    case "tools":
      return setTools(fleet, id, body.tools)
    case "backend":
      await assertSafeComputer(fleet, body.backend)
      return setBackend(fleet, id, body.backend)
  }
})

export const DELETE = route<P>({ mutate: true, builder: true }, async ({ fleet, params }) => {
  await deleteAgent(fleet, uuid(params.id))
  return { ok: true }
})
