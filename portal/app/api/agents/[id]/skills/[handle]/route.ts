import { detachSkill } from "@/lib/fleet/ops"
import { route, slug, uuid } from "@/lib/fleet/server"

export const DELETE = route<{ id: string; handle: string }>({ mutate: true, builder: true }, async ({ fleet, params }) =>
  detachSkill(fleet, uuid(params.id), slug(decodeURIComponent(params.handle), "skill")),
)
