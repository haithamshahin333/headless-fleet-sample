/**
 * Liveness and readiness for Kubernetes. No sign-in, no upstream calls and no configuration
 * details: it answers whether this process serves requests, nothing more. A bad
 * configuration never gets this far — instrumentation.ts stops the server at startup.
 */
export const dynamic = "force-dynamic"

export function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
}
