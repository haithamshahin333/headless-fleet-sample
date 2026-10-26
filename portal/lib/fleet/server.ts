import "server-only"

import { getToken } from "next-auth/jwt"
import { cookies, headers } from "next/headers"
import type { NextRequest } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { config as appConfig, DEV_LOGIN } from "@/lib/config"
import { isSkillName } from "@/lib/skills/rules"
import { FleetClient, FleetError, type FleetIdentity } from "./core"
import { listWorkspaces, type Workspace } from "./ops"
import { fresh, refreshFleetToken } from "./token"

/**
 * The only place that turns a portal session into a Fleet identity.
 *
 * Invariant: the credential sent to Fleet is the user's own access token, read ONLY
 * from the encrypted session cookie on the server. Nothing in a request body, query or
 * header can change who the portal calls Fleet as, and the token never goes to the browser.
 */

export const config = {
  baseUrl: appConfig.langsmith.apiUrl,
  orgId: appConfig.langsmith.orgId,
  defaultWorkspace: appConfig.langsmith.defaultWorkspace,
  langsmithUi: appConfig.langsmith.uiUrl,
}

export type PortalUser = {
  /** The subject claim LangSmith maps to this user (dev mode: the persona). */
  uid: string
  name: string
  email: string
  roles: string[]
  dev: boolean
  can_build: boolean
  is_admin: boolean
}

/** The caller's Fleet access token from the session cookie, refreshed when it is about to expire. */
async function fleetAccessToken(): Promise<string> {
  const jwt = await getToken({
    req: { headers: await headers() },
    secret: process.env.AUTH_SECRET,
    secureCookie: (process.env.AUTH_URL ?? "").startsWith("https://"),
  })
  const t = jwt?.fleet
  if (!t?.rt) throw new PortalError(401, "Sign in again to continue.")
  if (fresh(t)) return t.at
  try {
    // Usually the proxy refreshed this same token a moment ago: the shared refresh returns its result.
    return (await refreshFleetToken(t.rt)).at
  } catch {
    throw new PortalError(401, "Your sign-in expired. Sign in again.")
  }
}

async function identityFor(): Promise<FleetIdentity> {
  if (DEV_LOGIN) {
    const apiKey = process.env.LANGSMITH_API_KEY
    if (!apiKey) throw new PortalError(500, "Dev mode needs LANGSMITH_API_KEY in the server environment.")
    return { mode: "api-key", apiKey }
  }
  return { mode: "bearer", token: await fleetAccessToken() }
}

export class PortalError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function currentUser(): Promise<PortalUser | null> {
  const session = await auth()
  const u = session?.user
  if (!u?.uid || u.reauth) return null
  const roles = u.roles ?? []
  return {
    uid: u.uid,
    name: u.name ?? "",
    email: u.email ?? "",
    roles,
    dev: !!u.dev,
    can_build: roles.some((r) => appConfig.builderRoles.includes(r)),
    is_admin: roles.some((r) => appConfig.adminRoles.includes(r)),
  }
}

export async function baseClient(user: PortalUser, tenantId?: string): Promise<FleetClient> {
  if (!config.baseUrl) throw new PortalError(500, "LANGSMITH_API_URL is not set (e.g. https://<langsmith-host>/api).")
  return new FleetClient({ baseUrl: config.baseUrl, identity: await identityFor(), tenantId, logAs: user.uid })
}

// Workspaces per user, cached briefly: the switcher and every request validate against it.
const g = globalThis as unknown as { __wsCache?: Map<string, { at: number; list: Workspace[] }> }
const wsCache = (g.__wsCache ??= new Map())

export async function workspacesFor(user: PortalUser): Promise<Workspace[]> {
  const hit = wsCache.get(user.uid)
  if (hit && Date.now() - hit.at < 60_000) return hit.list
  let list: Workspace[] = []
  try {
    list = await listWorkspaces(await baseClient(user), config.orgId)
  } catch (err) {
    // A PAT (dev mode) cannot reach the tenantless chain; fall back to configuration.
    if (!(err instanceof FleetError && [401, 403, 404].includes(err.status))) throw err
  }
  if (!list.length && config.defaultWorkspace) list = [{ id: config.defaultWorkspace, name: "Workspace" }]
  wsCache.set(user.uid, { at: Date.now(), list })
  return list
}

export async function selectedWorkspace(user: PortalUser): Promise<{ current: Workspace | null; all: Workspace[] }> {
  const all = await workspacesFor(user)
  const wanted = (await cookies()).get("ws")?.value
  // The cookie is a preference, never trusted on its own: it must be one of the
  // caller's own workspaces (Fleet would 403 anyway, but we fail fast and clearly).
  const current = all.find((w) => w.id === wanted) ?? all[0] ?? null
  return { current, all }
}

// ── validation ──────────────────────────────────────────────────────────────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function uuid(v: string | undefined, what = "id"): string {
  if (!v || !UUID.test(v)) throw new PortalError(400, `invalid ${what}`)
  return v
}
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
export function slug(v: string | undefined, what = "name"): string {
  if (!v || !SLUG.test(v)) throw new PortalError(400, `invalid ${what}`)
  return v
}
/** A workspace skill's handle, by Fleet's own name rule. */
export function skillHandle(v: string | undefined): string {
  if (!v || !isSkillName(v)) throw new PortalError(400, "invalid skill name")
  return v
}

/**
 * Read a JSON body, refusing it past `max` bytes BEFORE parsing: by the declared length,
 * and again while streaming, since the header can lie or be absent.
 */
export async function readJsonCapped(req: NextRequest, max: number): Promise<unknown> {
  const tooBig = () => new PortalError(413, `Request larger than ${Math.round(max / 1e6)} MB.`)
  if (Number(req.headers.get("content-length") ?? 0) > max) throw tooBig()
  if (!req.body) throw new PortalError(400, "missing body")
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    n += value.length
    if (n > max) {
      await reader.cancel()
      throw tooBig()
    }
    chunks.push(value)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    throw new PortalError(400, "invalid JSON")
  }
}

// ── error mapping: native enforcement becomes an explanation ────────────────────
function explain(err: FleetError): { status: number; body: Record<string, unknown> } {
  const d = err.detail
  const low = d.toLowerCase()
  let hint: string | undefined
  if (err.status === 403 && low.includes("user not found")) {
    hint = "Your account isn't set up in LangSmith yet. Contact your platform team."
  } else if (err.path.startsWith("/v1/fleet/skills")) {
    const b = (err.body ?? {}) as { path?: unknown; rule?: unknown }
    if (err.status === 409) hint = "A skill with this name already exists in this workspace. Choose another name."
    else if (err.status === 422) hint = b.path ? `LangSmith rejected ${String(b.path)}${b.rule ? `: ${String(b.rule)}` : ""}.` : "LangSmith rejected this skill's files."
    else if (err.status === 413) hint = "Too large for LangSmith (5 MiB per skill)."
    else if (err.status === 403 && err.method === "DELETE") hint = "Only the skill's creator can delete it."
    else if (err.status === 403) hint = "LangSmith denied this for your account."
  } else if (low.includes("spend") || low.includes("usage limit") || err.status === 402) {
    hint = "Your weekly agent spend cap has been reached. Your LangSmith admin sets this in Fleet › Usage."
  } else if (err.status === 422 && (err.code === "model_not_supported" || low.includes("model"))) {
    hint = "That model isn't enabled for Fleet in this workspace. Admins enable models under Settings › Model configurations › Feature access."
  } else if (err.status === 403 && /integration|mcp|tool/.test(err.path + low)) {
    hint = "Restricted by your LangSmith admin (workspace role or access policy)."
  } else if (err.status === 403 && err.method === "PATCH" && low.includes("shar")) {
    hint = "Only the agent's owner can change sharing."
  } else if (err.status === 403) {
    hint = "LangSmith denied this for your account."
  }
  const status = err.status >= 500 ? 502 : err.status
  return { status, body: { detail: d, code: err.code, enforced_by: "langsmith", hint } }
}

/** One line for a partial failure reported inside a successful response. */
export function explainText(err: unknown): string {
  if (err instanceof FleetError) {
    const { body } = explain(err)
    return String(body.hint ?? body.detail)
  }
  return err instanceof Error ? err.message : String(err)
}

export function errorResponse(err: unknown): Response {
  if (err instanceof PortalError) return Response.json({ detail: err.message, enforced_by: "portal" }, { status: err.status })
  if (err instanceof FleetError) {
    const { status, body } = explain(err)
    return Response.json(body, { status })
  }
  if (err instanceof z.ZodError) {
    return Response.json({ detail: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 })
  }
  console.error("[portal] unhandled", err)
  return Response.json({ detail: "Unexpected server error" }, { status: 500 })
}

/** Why Build is refused: off for everyone, or not one of your roles. */
export function buildRefusal(): string {
  return appConfig.builderRoles.length
    ? `Building agents is limited to these roles: ${appConfig.builderRoles.join(", ")}.`
    : "Build is turned off in this portal: no builder roles are configured."
}

// ── the route wrapper every API handler uses ────────────────────────────────────
export type Ctx<P> = { req: NextRequest; user: PortalUser; fleet: FleetClient; workspace: Workspace | null; params: P }

/** CSRF: same-origin + a custom header a cross-site form cannot send. */
function checkMutation(req: NextRequest) {
  if (req.headers.get("x-portal-request") !== "1") throw new PortalError(403, "missing X-Portal-Request header")
  const origin = req.headers.get("origin")
  const expected = new URL(process.env.AUTH_URL ?? req.url).origin
  if (!origin || origin !== expected) throw new PortalError(403, "cross-origin request refused")
}

export function route<P = Record<string, string>>(
  opts: { mutate?: boolean; builder?: boolean; workspace?: boolean },
  fn: (ctx: Ctx<P>) => Promise<unknown>,
) {
  return async (req: NextRequest, rc: { params: Promise<P> }): Promise<Response> => {
    try {
      const user = await currentUser()
      if (!user) return Response.json({ detail: "Sign in required" }, { status: 401 })
      if (opts.mutate) checkMutation(req)
      // UX gating only — LangSmith does not enforce agent creation on this version.
      if (opts.builder && !user.can_build) throw new PortalError(403, buildRefusal())
      const { current } = opts.workspace === false ? { current: null } : await selectedWorkspace(user)
      if (opts.workspace !== false && !current) throw new PortalError(403, "You don't belong to any workspace.")
      const fleet = await baseClient(user, current?.id)
      const params = (await rc.params) ?? ({} as P)
      const out = await fn({ req, user, fleet, workspace: current, params })
      if (out instanceof Response) return out
      return Response.json(out ?? null)
    } catch (err) {
      return errorResponse(err)
    }
  }
}
