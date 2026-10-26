import { getThreadState } from "@/lib/fleet/ops"
import { route, uuid } from "@/lib/fleet/server"

/** Authoritative thread state. Fleet only returns threads the caller owns. */
export const GET = route<{ tid: string }>({}, async ({ fleet, params }) => getThreadState(fleet, uuid(params.tid, "thread id")))
