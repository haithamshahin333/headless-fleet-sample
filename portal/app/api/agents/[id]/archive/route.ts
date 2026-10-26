import { archiveAgent, unarchiveAgent } from "@/lib/fleet/ops"
import { route, uuid } from "@/lib/fleet/server"

type P = { id: string }
/** Archive hides the agent and stops it running; reversible. Owner-only in Fleet. */
export const POST = route<P>({ mutate: true, builder: true }, async ({ fleet, params }) => archiveAgent(fleet, uuid(params.id)))
export const DELETE = route<P>({ mutate: true, builder: true }, async ({ fleet, params }) => unarchiveAgent(fleet, uuid(params.id)))
