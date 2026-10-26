import { FleetError } from "@/lib/fleet/core"
import { sandboxFileContent } from "@/lib/fleet/ops"
import { PortalError, route, slug } from "@/lib/fleet/server"

/** Download one file from a computer. Served as an attachment, never rendered inline. */
export const GET = route<{ slug: string }>({}, async ({ req, fleet, params }) => {
  const path = req.nextUrl.searchParams.get("path") ?? ""
  if (!path || path.length > 1000 || path.includes("\0")) throw new PortalError(400, "invalid path")
  const res = await sandboxFileContent(fleet, slug(params.slug, "sandbox"), path)
  if (!res.ok) throw new FleetError("GET", "/sandboxes/files/content", res.status, await res.json().catch(() => ({ detail: res.statusText })))
  const name = path.split("/").pop()?.replace(/[^A-Za-z0-9._-]/g, "_") || "file"
  return new Response(res.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
    },
  })
})
