import { setPermissions } from "@/lib/fleet/ops"
import { Permissions } from "@/lib/fleet/schemas"
import { route, uuid } from "@/lib/fleet/server"

/** Publish / share. Owner-only — Fleet enforces it and answers 403 otherwise. */
export const PUT = route<{ id: string }>({ mutate: true, builder: true }, async ({ req, fleet, params }) =>
  setPermissions(fleet, uuid(params.id), Permissions.parse(await req.json())),
)
