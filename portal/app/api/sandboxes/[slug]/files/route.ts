import { sandboxFiles } from "@/lib/fleet/ops"
import { PortalError, route, slug } from "@/lib/fleet/server"

/** List files in a computer (sandbox). Fleet checks the caller may read it. */
export const GET = route<{ slug: string }>({}, async ({ req, fleet, params }) => {
  const path = req.nextUrl.searchParams.get("path") ?? undefined
  if (path && (path.length > 1000 || path.includes("\0"))) throw new PortalError(400, "invalid path")
  return sandboxFiles(fleet, slug(params.slug, "sandbox"), path)
})
