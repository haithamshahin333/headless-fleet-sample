import { removeSubagent } from "@/lib/fleet/ops"
import { route, slug, uuid } from "@/lib/fleet/server"

export const DELETE = route<{ id: string; name: string }>({ mutate: true, builder: true }, async ({ fleet, params }) =>
  removeSubagent(fleet, uuid(params.id), slug(decodeURIComponent(params.name), "subagent")),
)
