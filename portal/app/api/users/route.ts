import { z } from "zod"

import { searchUsers } from "@/lib/fleet/ops"
import { route } from "@/lib/fleet/server"

type U = { id?: unknown; name?: unknown; email?: unknown }
const Ids = z.array(z.string().uuid()).max(200)

/**
 * Resolve colleagues for sharing: `?search=` (name/email) or `?ids=a,b` (to label an
 * agent's existing shares). `GET /v1/fleet/users` is workspace-scoped and works for any
 * caller; the per-tenant user route is not available to every credential.
 */
export const GET = route({}, async ({ req, fleet }) => {
  const sp = req.nextUrl.searchParams
  const pick = (u: U) => ({ id: String(u.id), name: u.name as string | undefined, email: u.email as string | undefined })
  const ids = sp.get("ids")
  if (ids) {
    const want = new Set(Ids.parse(ids.split(",").filter(Boolean)))
    const found: ReturnType<typeof pick>[] = []
    let cursor: string | undefined
    for (let i = 0; i < 5 && found.length < want.size; i++) {
      const page = await fleet.get<{ items?: U[]; next_cursor?: string }>("/v1/fleet/users", { page_size: 100, cursor })
      for (const u of page.items ?? []) if (want.has(String(u.id))) found.push(pick(u))
      cursor = page.next_cursor ?? undefined
      if (!cursor) break
    }
    return { items: found }
  }
  const q = (sp.get("search") ?? "").slice(0, 100)
  return { items: (await searchUsers(fleet, q)).map(pick) }
})
