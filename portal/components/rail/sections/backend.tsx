"use client"

import { useEffect, useState } from "react"

import { getPolicies, getSnapshots, putBackend } from "@/lib/api"
import type { Agent, SandboxPolicy, Snapshot } from "@/lib/types"
import { CheckRow, inputClass, RailEditor } from "../RailEditor"

/**
 * Execution backend: thread state, or a real sandbox microVM.
 *
 * `sandbox_id` is deliberately not requested here — it is assigned lazily when the agent
 * first runs, so it is absent immediately after configuring and its absence means
 * nothing is wrong.
 */
export function BackendSection({
  agent,
  onSaved,
}: {
  agent: Agent
  onSaved: (a: Agent) => void
}) {
  const cfg = agent.backend?.sandbox_config
  const initial = {
    type: agent.backend?.type ?? "state",
    snapshot_id: cfg?.snapshot_id ?? "",
    policy_ids: cfg?.policy_ids ?? [],
    // Per-conversation by default: one shared computer leaks files (and any per-user
    // credential profile) across everyone who runs the agent.
    scope: cfg?.scope ?? "thread",
  }
  const key = JSON.stringify(initial)

  const [draft, setDraft] = useState(initial)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [policies, setPolicies] = useState<SandboxPolicy[]>([])

  useEffect(() => setDraft(JSON.parse(key)), [key])
  useEffect(() => {
    // Only fetch when the user actually looks at a sandbox; both lists are small but
    // there is no reason to pull them for a state-backed agent.
    if (draft.type !== "sandbox" || snapshots.length > 0) return
    getSnapshots().then((r) => setSnapshots(r.items)).catch(() => {})
    getPolicies().then((r) => setPolicies(r.items)).catch(() => {})
  }, [draft.type, snapshots.length])

  const needsSnapshot = draft.type === "sandbox" && !draft.snapshot_id

  return (
    <RailEditor
      label="Backend"
      summary={initial.type}
      dirty={JSON.stringify(draft) !== key}
      disabled={needsSnapshot}
      onCancel={() => setDraft(JSON.parse(key))}
      onSave={async () =>
        onSaved(
          await putBackend(agent.id, {
            type: draft.type,
            snapshot_id: draft.type === "sandbox" ? draft.snapshot_id : null,
            policy_ids: draft.type === "sandbox" ? draft.policy_ids : [],
            scope: draft.scope,
          }),
        )
      }
    >
      <div className="flex flex-col gap-1">
        {(["state", "sandbox"] as const).map((k) => (
          <label key={k} className="flex cursor-pointer items-start gap-2 text-[11.5px]">
            <input
              type="radio"
              name={`backend-${agent.id}`}
              checked={draft.type === k}
              onChange={() => setDraft((d) => ({ ...d, type: k }))}
              className="mt-0.5 accent-[var(--brand)]"
            />
            <span>
              <span className="block">{k}</span>
              <span className="block text-[10px] text-muted-foreground">
                {k === "state"
                  ? "Files live in thread state. No VM."
                  : "A microVM with a real filesystem and shell."}
              </span>
            </span>
          </label>
        ))}
      </div>

      {draft.type === "sandbox" && (
        <>
          <select
            value={draft.scope}
            onChange={(e) => setDraft((d) => ({ ...d, scope: e.target.value }))}
            className={inputClass}
          >
            <option value="agent">agent-scoped (one sandbox, shared across threads)</option>
            <option value="thread">thread-scoped (one per conversation)</option>
          </select>

          <select
            value={draft.snapshot_id}
            onChange={(e) => setDraft((d) => ({ ...d, snapshot_id: e.target.value }))}
            className={inputClass}
          >
            <option value="">Choose a boot image…</option>
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name ?? s.id}{s.status && s.status !== "ready" ? ` (${s.status})` : ""}
              </option>
            ))}
          </select>
          {needsSnapshot && (
            <p className="text-[10px] text-muted-foreground">A sandbox needs a boot image.</p>
          )}

          <div className="flex flex-col gap-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Access policies
            </p>
            {policies.map((p) => (
              <CheckRow
                key={p.id}
                checked={draft.policy_ids.includes(p.id)}
                onChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    policy_ids: v
                      ? [...d.policy_ids, p.id]
                      : d.policy_ids.filter((x) => x !== p.id),
                  }))
                }
                label={p.name ?? p.id}
              />
            ))}
            {policies.length === 0 && (
              <p className="text-[10px] text-muted-foreground">
                No access policies in this workspace.
              </p>
            )}
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            The sandbox itself is provisioned on the agent&rsquo;s next run, so its id
            appears afterwards, not now.
          </p>
        </>
      )}
    </RailEditor>
  )
}
