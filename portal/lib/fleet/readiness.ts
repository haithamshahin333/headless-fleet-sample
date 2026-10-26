/**
 * "Can THIS user run THIS agent right now?" — the OAuth on-behalf-of (OBO) readiness
 * check, shown as a checklist before the first message.
 *
 * Why it has to exist (LangSmith 0.17):
 *   * Fleet has no endpoint that lists an agent's required providers, and no agent
 *     health route — the requirement must be derived from the agent's tools.
 *   * `identity=personal` agents resolve the CALLER's own default token per provider at
 *     run time, with no per-agent binding. If it is missing, a non-owner's run hits an
 *     `auth_unavailable` interrupt that carries NO consent URL (only owners get
 *     `auth_required` + `auth_url`) — a dead end unless the portal connects them first.
 *   * `identity=shared` agents use the agent's bound connection; only owners/editors can
 *     bind one.
 *   * There is no token-exchange grant: a consent popup is always the OBO step.
 *
 * Derivation: tool →
 * integration (by `mcp_server_name`, then by normalized `mcp_server_url`) →
 * `auth_methods[].provider_match` → provider slug. Subagent tools count too.
 */
import type { FleetClient } from "./core"
import { FleetError } from "./core"
import { agentConnections, startConnection, tokens, type Token } from "./ops"

type Obj = Record<string, unknown>

export type ProviderStatus =
  /** The caller holds a usable token (personal) / the agent has a binding (shared). */
  | "connected"
  /** Personal agent, caller has no token: they can fix it with Connect. */
  | "missing"
  /** Shared agent with no binding: only an owner/editor can fix it. */
  | "owner_must_connect"
  /** Shared agent, caller cannot read the bindings (run-only): assume managed. */
  | "managed_by_owner"

export type RequiredProvider = {
  slug: string
  /** Integration display names this provider powers, e.g. ["Outlook", "OneDrive"]. */
  integrations: string[]
  tools: string[]
  scopes: string[]
  status: ProviderStatus
  expires_at?: string | null
  refreshed?: boolean
}

export type Readiness = {
  identity: "personal" | "shared"
  can_bind: boolean
  providers: RequiredProvider[]
  ready: boolean
  /** A soft failure reading state — UI warns but still allows chatting. */
  warning?: string
}

const norm = (u?: unknown) => String(u ?? "").trim().replace(/\/+$/, "")

function providerOf(integration: Obj): { slug: string; scopes: string[] } | null {
  for (const m of (integration.auth_methods as Obj[] | undefined) ?? []) {
    const match = m?.provider_match as Obj | undefined
    if (match?.value && (match.by === "slug" || !match.by)) {
      return { slug: String(match.value), scopes: (m.scopes as string[] | undefined) ?? [] }
    }
  }
  return null
}

function allTools(agent: Obj): Obj[] {
  const own = ((agent.tools as Obj | undefined)?.tools as Obj[] | undefined) ?? []
  const subs = ((agent.subagents as Obj[] | undefined) ?? []).flatMap(
    (s) => (((s.tools as Obj | undefined)?.tools as Obj[] | undefined) ?? []),
  )
  return [...own, ...subs]
}

/** Pure: which OAuth providers does this agent need? */
export function requiredProviders(agent: Obj, integrations: Obj[]): Omit<RequiredProvider, "status">[] {
  const byName = new Map(integrations.map((i) => [String(i.name), i]))
  const byUrl = new Map(integrations.map((i) => [norm(i.url), i]))
  const out = new Map<string, Omit<RequiredProvider, "status">>()
  for (const t of allTools(agent)) {
    const integ = byName.get(String(t.mcp_server_name ?? "")) ?? byUrl.get(norm(t.mcp_server_url))
    if (!integ) continue
    const p = providerOf(integ)
    if (!p) continue // no OAuth (public MCP, workspace-secret tools like Tavily)
    const entry = out.get(p.slug) ?? { slug: p.slug, integrations: [], tools: [], scopes: p.scopes }
    const iname = String(integ.name ?? integ.url)
    if (!entry.integrations.includes(iname)) entry.integrations.push(iname)
    entry.tools.push(String(t.display_name ?? t.name))
    out.set(p.slug, entry)
  }
  return [...out.values()]
}

const expired = (t: Token) => !!t.expires_at && Date.parse(t.expires_at) < Date.now() + 60_000

/** Async: status per provider for the caller, refreshing expired personal tokens. */
export async function readiness(c: FleetClient, agent: Obj, integrations: Obj[]): Promise<Readiness> {
  const identity = ((agent.permissions as Obj | undefined)?.identity as string) === "shared" ? "shared" : "personal"
  const canBind = agent.is_owner === true || agent.access_level === "write"
  const needed = requiredProviders(agent, integrations)
  if (!needed.length) return { identity, can_bind: canBind, providers: [], ready: true }

  try {
    if (identity === "personal") {
      const mine = await tokens(c)
      const providers: RequiredProvider[] = []
      for (const n of needed) {
        const toks = mine.filter((t) => t.provider_slug === n.slug)
        const tok = toks.find((t) => t.is_default) ?? toks[0]
        if (!tok) {
          providers.push({ ...n, status: "missing" })
          continue
        }
        if (expired(tok)) {
          // REUSE refreshes in place and returns `completed` with no URL when it can.
          const s = await startConnection(c, n.slug, n.scopes).catch(() => null)
          const done = s && !s.verification_url
          providers.push({ ...n, status: done ? "connected" : "missing", expires_at: tok.expires_at, refreshed: !!done })
          continue
        }
        providers.push({ ...n, status: "connected", expires_at: tok.expires_at })
      }
      return { identity, can_bind: canBind, providers, ready: providers.every((p) => p.status === "connected") }
    }

    // Shared identity: the AGENT's binding decides, not the caller's tokens.
    let boundSlugs: Set<string> | null = null
    try {
      const bound = await agentConnections(c, String(agent.id))
      // A binding may carry only `auth_token_id`; resolve its provider via the caller's tokens.
      const bySlug = new Map((await tokens(c).catch(() => [] as Token[])).map((t) => [t.id, t.provider_slug]))
      boundSlugs = new Set(bound.map((b) => b.provider_slug ?? (b.auth_token_id ? bySlug.get(b.auth_token_id) : undefined)).filter(Boolean) as string[])
    } catch (err) {
      if (!(err instanceof FleetError && [403, 404].includes(err.status))) throw err
    }
    const providers: RequiredProvider[] = needed.map((n) => ({
      ...n,
      status: boundSlugs === null ? "managed_by_owner" : boundSlugs.has(n.slug) ? "connected" : "owner_must_connect",
    }))
    return {
      identity,
      can_bind: canBind,
      providers,
      // Managed-by-owner is not a blocker: the consumer cannot verify or fix it.
      ready: providers.every((p) => p.status !== "owner_must_connect"),
    }
  } catch (err) {
    return {
      identity,
      can_bind: canBind,
      providers: needed.map((n) => ({ ...n, status: identity === "personal" ? "missing" : "managed_by_owner" })),
      ready: true,
      warning: err instanceof Error ? err.message.slice(0, 200) : "could not verify connections",
    }
  }
}
