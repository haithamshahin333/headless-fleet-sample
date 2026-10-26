import { upsertSubagent } from "@/lib/fleet/ops"
import { Subagent } from "@/lib/fleet/schemas"
import { route, uuid } from "@/lib/fleet/server"

/** Upsert ONE subagent by name (Fleet merges; it does not drop the others). */
export const PUT = route<{ id: string }>({ mutate: true, builder: true }, async ({ req, fleet, params }) =>
  upsertSubagent(fleet, uuid(params.id), Subagent.parse(await req.json())),
)
