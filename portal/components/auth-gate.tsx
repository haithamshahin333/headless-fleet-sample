"use client"

import type { Agent, Interrupt } from "@/lib/types"
import { useConnect } from "@/lib/use-connect"
import { providerName } from "./connection-gate"
import { Button, Mono } from "./ui"

/**
 * A run paused because a tool needs an OAuth connection (Fleet's AuthCheckMiddleware).
 *
 * Fleet only gives the agent's OWNER a consent URL (`auth_required`); everyone else gets
 * `auth_unavailable` with no URL — a dead end in a naive UI. For a personal-identity
 * agent the fix is the caller's OWN connection, which this app can start for them; then
 * the run resumes with `{type: "auth_required_response", action: "continue"}`. For a
 * shared-identity agent only the owner/editor can fix it, so the user can Skip.
 */
export function AuthGate({
  agent,
  interrupt,
  busy,
  onResolve,
}: {
  agent: Agent
  interrupt: Interrupt
  busy: boolean
  onResolve: (action: "continue" | "skip") => void
}) {
  const slug = interrupt.auth?.provider
  const shared = agent.permissions?.identity === "shared"
  const canBind = agent.is_owner || agent.access_level === "write"
  const fixable = !shared || canBind
  const conn = useConnect(shared && canBind ? agent.id : undefined, () => onResolve("continue"))
  const waiting = conn.state === "connecting" || conn.state === "waiting"

  return (
    <div className="animate-gate-in max-w-[62ch] rounded-2xl bg-brand-subtle p-4 ring-1 ring-brand-border">
      <p className="mb-1 text-[13px] font-semibold text-brand">🔌 {providerName(slug)} connection needed</p>
      <p className="mb-3 text-[13px]">
        The agent wants to use <Mono className="font-medium">{interrupt.auth?.tool ?? "a tool"}</Mono>
        {fixable
          ? shared
            ? ", which runs with this agent's own connection. Connect it to bind it to the agent."
            : ", which acts as you. Connect your account to continue."
          : `, which runs with this agent's shared connection — managed by ${agent.owner?.name ?? "its owner"}.`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {fixable && slug && (
          <Button variant="primary" size="sm" disabled={busy || waiting} onClick={() => conn.connect(slug, interrupt.auth?.scopes ?? [])}>
            {waiting ? "Waiting for authorization…" : shared ? "Connect & bind" : `Connect ${providerName(slug)}`}
          </Button>
        )}
        <Button variant="default" size="sm" disabled={busy || waiting} onClick={() => onResolve("skip")}>
          Skip this tool
        </Button>
      </div>
      {conn.consentUrl && waiting && (
        <a href={conn.consentUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[11px] text-brand underline">
          Popup blocked? Open the authorization page
        </a>
      )}
      {conn.state === "failed" && <p className="mt-2 text-[11px] text-destructive">{conn.note}</p>}
      <p className="mt-2.5 text-[11px] text-muted-foreground">
        Resumed with <Mono className="text-[11px]">command.resume</Mono> · Fleet interrupt <Mono className="text-[11px]">{interrupt.kind}</Mono>
      </p>
    </div>
  )
}
