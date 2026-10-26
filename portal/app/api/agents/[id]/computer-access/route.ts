import { setUpComputerAccess } from "@/lib/fleet/computer-access"
import { route, uuid } from "@/lib/fleet/server"

/**
 * Explicit "Set up Graph access" for this agent's computer: reuse or create the CALLER's
 * own Microsoft Graph access profile and attach it. Owner/editor only (checked again in
 * setUpComputerAccess against Fleet's caller-relative access level).
 */
export const POST = route<{ id: string }>({ mutate: true, builder: true }, async ({ fleet, params }) =>
  setUpComputerAccess(fleet, uuid(params.id)),
)
