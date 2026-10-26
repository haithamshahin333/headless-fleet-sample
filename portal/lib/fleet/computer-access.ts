/**
 * "Can this agent's computer call Microsoft Graph as me?" — the access-profile half of
 * readiness, plus the one-click fix.
 *
 * An access profile (API: sandbox policy) is an egress rule set on the agent's sandbox:
 * the proxy matches the destination host, resolves a credential and injects it as a
 * header. Nothing inside the sandbox ever holds the token. Facts this module rests on
 * (checked against a live self-hosted install):
 *
 *   * Profiles live under `/v1/platform/fleet/sandboxes/policies`, not `/v1/fleet`.
 *   * They are USER-scoped: List = the caller's own; Get(id) = any in the workspace.
 *     There is no admin-on-behalf-of create, so each person makes their own — which is
 *     exactly what calling Fleet with each person's own token lets the portal do.
 *   * A connection source names a PROVIDER, not a connection. Every run re-mints the
 *     proxy's callback token with THAT run's user and re-applies it to the sandbox, so the
 *     token injected is always the person running now. A caller without a connection
 *     fails at the proxy, so the caller's connection is part of readiness.
 *   * Hence a computer shared by every user (scope "agent") must never carry such a
 *     profile: a process one user leaves running would act as the next user.
 *   * `network.allow_hosts` of all attached profiles are unioned into ONE allow list that
 *     restricts the computer to exactly those hosts; mixing allow and deny fails the run.
 *   * The inject template vocabulary is `{access_token}` (connection) / `{value}` (secret).
 *   * PATCHing an agent's backend REPLACES the whole sandbox block (see mergeSandboxConfig).
 */
import { config } from "@/lib/config"
import type { FleetClient } from "./core"
import { FleetError } from "./core"
import { getAgent, mergeSandboxConfig, sandboxConfigOf, tokens, updateAgent, type BackendSpec } from "./ops"
import { PortalError } from "./server"

type Obj = Record<string, unknown>

const PROVIDER_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: string) => UUID_RE.test(v)
const POLICIES = "/v1/platform/fleet/sandboxes/policies"

/** The org's own Microsoft provider (BYO Entra app). The bundled one does not resolve on the proxy path. */
export const GRAPH_PROVIDER = PROVIDER_RE.test(config.graphProvider) ? config.graphProvider : "microsoft-oauth-provider"
export const GRAPH_HOST = "graph.microsoft.com"
/** `.default` = every Graph permission admin-consented on the provider's app; empty scopes fail at Entra. */
export const GRAPH_SCOPES = ["https://graph.microsoft.com/.default"]
const PROFILE_NAME = "Microsoft Graph (portal)"

/**
 * A credential rule for Graph and nothing else — deliberately no `network` block. Any
 * allow list on any attached profile becomes the computer's ONLY reachable hosts (no
 * PyPI, GitHub, npm), and an allow list next to an admin's deny-list profile fails every
 * run. Egress stays whatever the computer's other profiles, or the plan default, allow.
 */
export function graphProfileConfig(provider = GRAPH_PROVIDER): Obj {
  return {
    rules: [
      {
        match_hosts: [GRAPH_HOST],
        source: { type: "connection", provider_id: provider },
        inject: [{ header: "Authorization", value: { type: "template", template: "Bearer {access_token}" } }],
      },
    ],
  }
}

const rulesOf = (p: Obj | null | undefined) => ((p?.config as Obj | undefined)?.rules as Obj[] | undefined) ?? []

export function isGraphProfile(p: Obj | null | undefined, provider = GRAPH_PROVIDER): boolean {
  return rulesOf(p).some((r) => {
    const hosts = (r.match_hosts as string[] | undefined) ?? []
    const src = r.source as Obj | undefined
    return hosts.includes(GRAPH_HOST) && src?.type === "connection" && src?.provider_id === provider
  })
}

/** Injects the RUNNING user's own OAuth token somewhere (any connection-sourced rule). */
export function actsAsUser(p: Obj | null | undefined): boolean {
  return rulesOf(p).some((r) => (r.source as Obj | undefined)?.type === "connection")
}

/** A profile that limits where the computer can connect (allow or deny list). */
export function limitsEgress(p: Obj): boolean {
  const n = (p.config as Obj | undefined)?.network as Obj | undefined
  return [n?.allow_hosts, n?.deny_hosts].some((l) => Array.isArray(l) && l.length > 0)
}

export type ProfileRef = { id: string; name: string }

export type ComputerAccess = {
  /** The agent runs on a sandbox ("computer"); otherwise nothing here applies. */
  applicable: boolean
  /** One computer for every user (scope "agent"): profiles that act as the user are unsafe here. */
  shared_computer: boolean
  provider: string
  scopes: string[]
  /** A Graph profile attached to THIS agent (any owner). */
  attached: ProfileRef | null
  /** The caller's own Graph profile, attached or not. `null` also when unreadable. */
  mine: ProfileRef | null
  /** The caller's own Graph profile still has the old host allow list (repairable by them). */
  mine_limits_egress: boolean
  /** Owner or editor: may attach a profile to this agent. */
  can_edit: boolean
  /** The caller's own token for the provider — what the proxy resolves at run time. */
  connection: "connected" | "missing" | "unknown"
  warning?: string
}

const ref = (p: Obj): ProfileRef => ({ id: String(p.id), name: String(p.name ?? p.id) })

async function myProfiles(c: FleetClient): Promise<Obj[]> {
  const res = await c.get<{ items?: Obj[] } | Obj[]>(POLICIES, { page_size: 100 })
  return Array.isArray(res) ? res : (res.items ?? [])
}

export async function computerAccess(c: FleetClient, agent: Obj): Promise<ComputerAccess> {
  const cfg = sandboxConfigOf(agent)
  const base: ComputerAccess = {
    applicable: cfg !== null,
    shared_computer: cfg?.scope === "agent",
    provider: GRAPH_PROVIDER,
    scopes: GRAPH_SCOPES,
    attached: null,
    mine: null,
    mine_limits_egress: false,
    can_edit: agent.is_owner === true || agent.access_level === "write",
    connection: "unknown",
  }
  if (!cfg) return base

  const warnings: string[] = []
  let mine: Obj[] = []
  try {
    mine = await myProfiles(c)
    const own = mine.find((p) => isGraphProfile(p))
    base.mine = own ? ref(own) : null
    base.mine_limits_egress = !!own && limitsEgress(own)
  } catch (err) {
    warnings.push(`access profiles not readable (${err instanceof FleetError ? err.status : "error"})`)
  }

  // Attached ids may belong to the owner: Get(id) is workspace-scoped, List is not.
  const ids = ((cfg.policy_ids as unknown[] | undefined) ?? []).map(String).filter(isUuid).slice(0, 50)
  for (const id of ids) {
    const local = mine.find((p) => String(p.id) === id)
    const p = local ?? (await c.get<Obj>(`${POLICIES}/${id}`).catch(() => null))
    if (isGraphProfile(p)) {
      base.attached = ref(p as Obj)
      if (!local && limitsEgress(p as Obj)) warnings.push("the owner's Graph profile limits this computer to Microsoft hosts")
      break
    }
  }

  try {
    const toks = (await tokens(c)).filter((t) => t.provider_slug === GRAPH_PROVIDER)
    base.connection = toks.length ? "connected" : "missing"
  } catch {
    warnings.push("connections not readable")
  }
  if (warnings.length) base.warning = warnings.join("; ")
  return base
}

/**
 * Refuse a computer shared by every user (scope "agent") that carries a profile acting as
 * the running user. Checked server-side on every create and computer update; a profile
 * that can't be read is refused too (fail closed).
 */
export async function assertSafeComputer(c: FleetClient, backend: BackendSpec | undefined): Promise<void> {
  if (backend?.type !== "sandbox" || backend.scope !== "agent" || !backend.policy_ids?.length) return
  const mine = await myProfiles(c).catch(() => [] as Obj[])
  for (const id of backend.policy_ids) {
    if (!isUuid(id)) throw new PortalError(400, "invalid access profile id")
    const p = mine.find((x) => String(x.id) === id) ?? (await c.get<Obj>(`${POLICIES}/${id}`).catch(() => null))
    if (!p) throw new PortalError(409, "Couldn't read an attached access profile, so a shared computer can't be confirmed safe.")
    if (actsAsUser(p)) {
      throw new PortalError(
        409,
        `"${ref(p).name}" uses each person's own connection, so it needs a per-conversation computer. ` +
          "On one shared computer, a process left by one user would act as the next. Switch the scope or remove the profile.",
      )
    }
  }
}

/**
 * Reuse or create the CALLER's own Graph profile. The config is fixed server-side; nothing
 * from the browser reaches it. Used by Build > Computer and by setUpComputerAccess.
 * Profiles made by an earlier version carried an allow list; it is removed in place
 * (owner-only update), since it cut the computer off from every other host.
 */
export async function ensureGraphProfile(c: FleetClient): Promise<ProfileRef & { created: boolean; config: Obj }> {
  const own = (await myProfiles(c)).find((p) => isGraphProfile(p))
  if (own) {
    if (!limitsEgress(own)) return { ...ref(own), created: false, config: (own.config as Obj) ?? graphProfileConfig() }
    const id = String(own.id)
    if (!isUuid(id)) throw new PortalError(502, "LangSmith returned a malformed access profile id.")
    const fixed = await c.patch<Obj>(`${POLICIES}/${id}`, { config: graphProfileConfig() }, "remove Graph profile allow list")
    if (limitsEgress(fixed ?? own)) throw new PortalError(502, "LangSmith kept the old network rules on your Graph profile. Edit it in LangSmith.")
    return { ...ref(own), created: false, config: (fixed?.config as Obj) ?? graphProfileConfig() }
  }
  const made = await c.post<Obj>(POLICIES, { name: PROFILE_NAME, config: graphProfileConfig() }, "create Graph access profile")
  if (!isUuid(String(made.id ?? ""))) throw new PortalError(502, "LangSmith did not return an access profile id.")
  return { ...ref(made), created: true, config: (made.config as Obj) ?? graphProfileConfig() }
}

/**
 * The explicit, user-initiated fix: reuse (or create) the CALLER's Graph profile and attach
 * it to this agent. Never automatic — attaching lets the sandbox send the user's token to Graph.
 */
export async function setUpComputerAccess(c: FleetClient, agentId: string): Promise<ComputerAccess> {
  if (!isUuid(agentId)) throw new PortalError(400, "Bad agent id.")
  const agent = await getAgent(c, agentId)
  const cfg = sandboxConfigOf(agent)
  if (!cfg) throw new PortalError(409, "This agent has no computer. Turn on its computer first.")
  if (!(agent.is_owner === true || agent.access_level === "write")) {
    throw new PortalError(403, "Only the owner or an editor can change this agent's computer access.")
  }
  if (cfg.scope === "agent") {
    throw new PortalError(409, "This agent has one computer shared by every user. Switch it to per-conversation in Build first.")
  }

  const pid = (await ensureGraphProfile(c)).id
  const ids = [...new Set([...((cfg.policy_ids as unknown[] | undefined) ?? []).map(String), pid])].filter(isUuid)
  if (ids.length > 50) throw new PortalError(409, "This agent already has too many access profiles.")
  const next: Obj = { scope: "thread", policy_ids: ids, ...(cfg.snapshot_id ? { snapshot_id: cfg.snapshot_id } : {}) }
  const updated = await updateAgent(c, agentId, { backend: { type: "sandbox", sandbox_config: mergeSandboxConfig(cfg, next) } }, "attach Graph access profile")
  return computerAccess(c, updated)
}
