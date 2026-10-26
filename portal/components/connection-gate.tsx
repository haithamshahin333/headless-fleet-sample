"use client"

import { useCallback, useEffect, useState } from "react"

import { createGraphProfile, getReadiness, setUpComputerAccess } from "@/lib/api"
import type { Agent, ComputerAccess, Readiness, RequiredProvider } from "@/lib/types"
import { useConnect } from "@/lib/use-connect"
import { Button, Mono } from "./ui"

const PRETTY: Record<string, string> = {
  "microsoft-oauth-provider": "Microsoft 365",
  "google-langsmith-prod": "Google",
  "slack-oauth-provider": "Slack",
  "salesforce-oauth-provider": "Salesforce",
  "linear-agent-builder": "Linear",
}
export const providerName = (slug?: string) => (slug ? PRETTY[slug] ?? slug : "this service")

/**
 * Pre-flight for on-behalf-of tools: before the first message, does THIS user have the
 * connections this agent will act with?
 *
 * - "Each user's own accounts" (personal) agents use the caller's own token per
 *   provider. Missing one is fixable right here with Connect.
 * - "Agent's connections" (shared) agents use the connection bound to the agent; only
 *   its owner or an editor can fix a missing one.
 *
 * Fleet has no endpoint for "what does this agent need", so the server derives it from
 * the agent's tools → integrations → OAuth provider.
 */
export function ConnectionGate({ agent, onReady }: { agent: Agent; onReady: (ready: boolean) => void }) {
  const [r, setR] = useState<Readiness | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(() => {
    getReadiness(agent.id)
      .then((x) => {
        setR(x)
        onReady(x.ready)
      })
      .catch((e) => {
        setErr(e instanceof Error ? e.message : "could not check connections")
        onReady(true) // uncertain check: warn, never hard-block
      })
  }, [agent.id, onReady])
  useEffect(load, [load])

  const shared = r?.identity === "shared"
  const conn = useConnect(shared && r?.can_bind ? agent.id : undefined, load)

  if (err) return <p className="rounded-xl border border-dashed px-3 py-2 text-[11.5px] text-muted-foreground">Couldn&apos;t verify your connections ({err}). The agent may ask you to connect mid-run.</p>
  const computer = r?.computer?.applicable ? r.computer : null
  if (!r || (r.providers.length === 0 && !computer)) return null

  return (
    <div className={`rounded-xl px-4 py-3 ring-1 ${r.ready ? "bg-card shadow-card ring-border/60" : "bg-brand-subtle ring-brand-border"}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[12px] font-semibold">
          {r.ready ? "Connections" : "Connect before you start"}
          <span className="ml-2 font-normal text-muted-foreground">
            {shared ? "This agent uses its own shared connections" : "This agent acts as you, with your own accounts"}
          </span>
        </p>
        {r.warning && <span className="text-[10.5px] text-muted-foreground">check incomplete</span>}
      </div>
      <ul className="flex flex-col gap-1.5">
        {r.providers.map((p) => (
          <ProviderRow key={p.slug} p={p} r={r} conn={conn} />
        ))}
        {computer && <ComputerRow agentId={agent.id} a={computer} onChange={load} />}
      </ul>
      {conn.note && <p className="mt-1.5 text-[11px] text-muted-foreground">{conn.note}</p>}
      {conn.consentUrl && conn.state === "waiting" && (
        <a href={conn.consentUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11px] text-brand underline">
          Popup blocked? Open the authorization page
        </a>
      )}
    </div>
  )
}

function ProviderRow({ p, r, conn }: { p: RequiredProvider; r: Readiness; conn: ReturnType<typeof useConnect> }) {
  const busy = conn.activeSlug === p.slug && (conn.state === "connecting" || conn.state === "waiting")
  const ok = p.status === "connected"
  return (
    <li className="flex items-center gap-2 text-[12px]">
      <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: ok ? "oklch(0.62 0.15 155)" : p.status === "managed_by_owner" ? "var(--muted-foreground)" : "var(--destructive)" }} />
      <span className="font-medium">{providerName(p.slug)}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground" title={p.tools.join(", ")}>
        {p.integrations.join(", ")}
        {p.refreshed && " · refreshed"}
      </span>
      {ok ? (
        <span className="text-[11px] text-muted-foreground">{r.identity === "personal" ? "connected as you" : "bound to agent"}</span>
      ) : p.status === "missing" ? (
        <Button size="sm" variant="primary" disabled={busy} onClick={() => conn.connect(p.slug, p.scopes)}>
          {busy ? "Waiting…" : "Connect"}
        </Button>
      ) : p.status === "owner_must_connect" && r.can_bind ? (
        <Button size="sm" variant="primary" disabled={busy} onClick={() => conn.connect(p.slug, p.scopes)}>
          {busy ? "Waiting…" : "Connect & bind"}
        </Button>
      ) : (
        <span className="text-[11px] text-muted-foreground">
          {p.status === "owner_must_connect" ? "the owner must connect this" : "managed by the owner"} <Mono className="text-[10px]">{p.slug}</Mono>
        </span>
      )}
    </li>
  )
}

/**
 * Microsoft Graph for the agent's computer: an access profile makes the sandbox's egress
 * proxy add the RUNNING user's own Graph token to requests for graph.microsoft.com.
 * Setting it up is always an explicit click — it lets code in the sandbox act as you on Graph.
 *
 * The row has its own connect flow that never binds: the proxy always uses the runner's
 * own token, so a Graph connection here must not become a shared-identity agent's binding.
 * A computer shared by every user can't carry this profile (the server refuses it too).
 */
function ComputerRow({ agentId, a, onChange }: { agentId: string; a: ComputerAccess; onChange: () => void }) {
  const conn = useConnect(undefined, onChange)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const connecting = conn.activeSlug === a.provider && (conn.state === "connecting" || conn.state === "waiting")
  const ok = !!a.attached && !a.shared_computer && a.connection === "connected"
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    setNote(null)
    try {
      await fn()
      setNote(done)
      onChange()
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not change Graph access.")
    } finally {
      setBusy(false)
    }
  }
  const muted = "text-[11px] text-muted-foreground"
  return (
    <li className="flex flex-col gap-0.5 text-[12px]">
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: ok ? "oklch(0.62 0.15 155)" : a.attached || a.can_edit ? "var(--destructive)" : "var(--muted-foreground)" }} />
        <span className="font-medium">Computer → Microsoft Graph</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={a.attached?.name ?? a.mine?.name ?? ""}>
          {a.attached ? `access profile “${a.attached.name}”` : "no Graph access profile on this computer"}
        </span>
        {ok ? (
          <span className={muted}>calls Graph as you</span>
        ) : a.shared_computer ? (
          <span className={muted}>{a.attached ? "unsafe on a shared computer" : "needs a per-conversation computer"}</span>
        ) : a.attached && a.connection !== "connected" ? (
          <Button size="sm" variant="primary" disabled={connecting} onClick={() => conn.connect(a.provider, a.scopes)}>
            {connecting ? "Waiting…" : "Connect"}
          </Button>
        ) : !a.attached && a.can_edit ? (
          <Button size="sm" variant="primary" disabled={busy} onClick={() => run(() => setUpComputerAccess(agentId), "Graph access attached. It applies from your next message.")}>
            {busy ? "Setting up…" : a.mine ? "Attach my Graph access" : "Set up Graph access"}
          </Button>
        ) : (
          <span className={muted}>the owner manages this computer</span>
        )}
      </div>
      {a.shared_computer && a.attached && (
        <p className="pl-3.5 text-[10.5px] text-destructive">
          Everyone who runs this agent shares one computer, and this profile hands each runner&apos;s Graph token to it. Switch the
          computer to “per conversation” in Build, or remove the profile.
        </p>
      )}
      {a.mine_limits_egress && (
        <p className="flex items-center gap-2 pl-3.5 text-[10.5px] text-destructive">
          Your Graph profile limits computers to Microsoft hosts (no PyPI, GitHub, npm).
          <Button size="sm" disabled={busy} onClick={() => run(createGraphProfile, "Host limit removed. It applies from your next message.")}>
            Remove host limit
          </Button>
        </p>
      )}
      {(note || conn.note || a.warning) && <p className="pl-3.5 text-[10.5px] text-muted-foreground">{note ?? conn.note ?? a.warning}</p>}
      {conn.consentUrl && conn.state === "waiting" && (
        <a href={conn.consentUrl} target="_blank" rel="noreferrer" className="pl-3.5 text-[10.5px] text-brand underline">
          Popup blocked? Open the authorization page
        </a>
      )}
    </li>
  )
}
