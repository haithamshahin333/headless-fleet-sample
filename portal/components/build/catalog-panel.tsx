"use client"

import clsx from "clsx"
import Link from "next/link"
import { useState } from "react"

import { createGraphProfile, getCatalog, type BackendDraft, type SubagentDraft, type ToolDraft } from "@/lib/api"
import presets from "@/lib/subagent-presets.json"
import type { Catalog, CreatedSkill, SandboxPolicy } from "@/lib/types"
import { providerFor } from "@/lib/use-connect"
import { inputClass } from "../rail/RailEditor"
import { ToolPicker } from "../rail/ToolPicker"
import { NewSkillDialog } from "./new-skill-dialog"
import { AgentAvatar, Button, Icon, Tag } from "../ui"

type Tab = "models" | "tools" | "skills" | "subagents" | "computer"
const TABS: [Tab, string][] = [
  ["models", "Models"],
  ["tools", "Tools"],
  ["skills", "Skills"],
  ["subagents", "Subagents"],
  ["computer", "Computer"],
]

export type CatalogSelection = {
  modelId?: string
  tools: ToolDraft[]
  skills: string[]
  subagents: string[]
  backend?: BackendDraft
}

/**
 * Catalog-first building: everything THIS user can put into an agent, as LangSmith
 * resolves it for them. Nothing here is filtered by the portal — an integration your
 * role or an ABAC policy denies arrives with `can_invoke: false` (shown locked); a model
 * the workspace has not enabled for Fleet simply is not in the list.
 */
export function CatalogPanel({
  catalog,
  selection,
  identity,
  bindAgentId,
  onModel,
  onAddTools,
  onSkill,
  onAddSubagent,
  onBackend,
  newSkill,
}: {
  catalog: Catalog
  selection: CatalogSelection
  identity: "personal" | "shared"
  bindAgentId?: string
  onModel: (id: string) => void
  onAddTools: (tools: ToolDraft[]) => void
  onSkill: (handle: string, on: boolean) => void
  onAddSubagent: (s: SubagentDraft) => void
  onBackend: (b: BackendDraft) => void
  /** Create a workspace skill from here: linked to `attachTo` at once, or added to the draft by `onCreated`. */
  newSkill?: { attachTo?: string; draft?: boolean; onCreated: (r: CreatedSkill) => void }
}) {
  const [tab, setTab] = useState<Tab>("tools")
  const [creatingSkill, setCreatingSkill] = useState(false)
  const [picker, setPicker] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const restricted = catalog.integrations.filter((i) => i.can_invoke === false).length
  const counts: Partial<Record<Tab, number>> = {
    tools: selection.tools.length,
    skills: selection.skills.length,
    subagents: selection.subagents.length,
  }
  const needle = q.trim().toLowerCase()
  const integrations = [...catalog.integrations]
    .filter((i) => !needle || (i.name ?? "").toLowerCase().includes(needle))
    .sort((a, b) => Number(b.can_invoke !== false) - Number(a.can_invoke !== false) || (a.name ?? "").localeCompare(b.name ?? ""))
  const hint = "pb-3 text-[12px] text-muted-foreground"

  return (
    <div className="flex flex-col gap-4">
      <div className="-mx-1 overflow-x-auto px-1 pb-0.5">
        <div className="inline-flex gap-0.5 rounded-full bg-secondary/70 p-1 dark:bg-muted" role="tablist">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={clsx(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12.5px] transition-colors",
                tab === k ? "bg-background font-medium text-foreground shadow-card dark:bg-accent" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
              {!!counts[k] && <span className="rounded-full bg-brand-subtle px-1.5 text-[10.5px] font-semibold text-brand">{counts[k]}</span>}
              {k === "computer" && selection.backend?.type === "sandbox" && <Icon name="check" className="h-3 w-3 text-brand" />}
            </button>
          ))}
        </div>
      </div>

      <div>
        {catalog.blocked[tab === "computer" ? "snapshots" : tab] && (
          <p className="mb-3 rounded-xl border border-dashed px-3 py-2 text-[12px] text-muted-foreground">
            LangSmith refused this catalog for you: {catalog.blocked[tab === "computer" ? "snapshots" : tab]}
          </p>
        )}

        {tab === "models" && (
          <>
            <p className={hint}>Models enabled for Fleet in this workspace.</p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {catalog.models.map((m) => {
                const on = selection.modelId === m.id
                return (
                  <li key={m.id}>
                    <button
                      disabled={m.ready === false}
                      onClick={() => onModel(m.id)}
                      className={clsx(
                        "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] ring-1 transition-colors disabled:opacity-50",
                        on ? "bg-brand-subtle ring-brand-border" : "bg-background ring-border/70 hover:bg-accent/60",
                      )}
                      title={m.ready === false ? `Missing workspace secret: ${m.required_secrets?.join(", ")}` : undefined}
                    >
                      <span className={clsx("grid h-7 w-7 flex-none place-items-center rounded-lg", on ? "bg-brand text-brand-foreground" : "bg-secondary text-muted-foreground dark:bg-accent")}>
                        <Icon name="chip" />
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{m.display_name ?? m.id}</span>
                      <Tag className="h-5 text-[10.5px]">{m.source === "built_in" ? "built-in" : "workspace"}</Tag>
                      {on && <Icon name="check" className="h-4 w-4 text-brand" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        {tab === "tools" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
              <p className="text-[12px] text-muted-foreground">
                {identity === "personal" ? "Tools act as each user, with their own connected account." : "Tools act with this agent's own connections."}
                {restricted > 0 && ` ${restricted} restricted for you by your LangSmith admin.`}
              </p>
              {catalog.integrations.length > 8 && (
                <label className="relative w-full sm:w-56">
                  <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tools" aria-label="Search tools" className={`${inputClass} py-1.5 pl-8`} />
                </label>
              )}
            </div>
            {integrations.length === 0 && <p className="text-[12.5px] text-muted-foreground">No tools match “{q}”.</p>}
            <ul className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 md:grid-cols-3">
              {integrations.map((i) => {
                const locked = i.can_invoke === false
                const count = selection.tools.filter((t) => t.mcp_server_url === i.url).length
                const oauth = !!providerFor(i).slug
                return (
                  <li key={i.id}>
                    <button
                      disabled={locked}
                      onClick={() => setPicker(i.id)}
                      title={locked ? "Restricted by your LangSmith admin (role or access policy)" : `Browse ${i.name} tools`}
                      className={clsx(
                        "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left ring-1 transition-colors disabled:cursor-not-allowed disabled:opacity-55",
                        count > 0 ? "bg-brand-subtle ring-brand-border" : "bg-background ring-border/70 hover:bg-accent/60 hover:ring-brand-border",
                      )}
                    >
                      <AgentAvatar id={i.id} name={i.name ?? ""} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className={clsx("block truncate text-[12.5px] font-medium", locked && "line-through")}>{i.name}</span>
                        <span className="block truncate text-[10.5px] text-muted-foreground">
                          {locked ? "restricted by admin" : count > 0 ? `${count} added` : oauth ? "sign-in required" : "no sign-in"}
                        </span>
                      </span>
                      {locked ? (
                        <Icon name="lock" className="text-muted-foreground" />
                      ) : count > 0 ? (
                        <Icon name="check" className="h-4 w-4 text-brand" />
                      ) : (
                        <Icon name="plus" className="text-muted-foreground" />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        {tab === "skills" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
              <p className="text-[12px] text-muted-foreground">
                Skills in this workspace&apos;s library.{" "}
                <Link href="/studio/skills" className="text-brand hover:underline">
                  Manage the library
                </Link>
              </p>
              {newSkill && (
                <Button size="sm" onClick={() => setCreatingSkill(true)}>
                  <Icon name="plus" />
                  New skill
                </Button>
              )}
            </div>
            {catalog.skills.length === 0 && <p className="text-[12.5px] text-muted-foreground">No workspace skills.</p>}
            <ul className="grid gap-2 sm:grid-cols-2">
              {catalog.skills.map((s) => {
                const on = selection.skills.includes(s.id)
                return (
                  <li key={s.id} className={clsx("flex items-start gap-3 rounded-xl px-3 py-2.5 ring-1", on ? "bg-brand-subtle ring-brand-border" : "bg-background ring-border/70")}>
                    <span className="mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-lg bg-secondary text-muted-foreground dark:bg-accent">
                      <Icon name="sparkle" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{s.name ?? s.id}</p>
                      {s.description && <p className="line-clamp-2 text-[11.5px] text-muted-foreground">{s.description}</p>}
                    </div>
                    <Button size="sm" variant={on ? "default" : "primary"} onClick={() => onSkill(s.id, !on)}>
                      {on ? "Remove" : "Add"}
                    </Button>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        {tab === "subagents" && (
          <>
            <p className={hint}>Fleet has no subagent catalog. These are your platform team&apos;s starter presets, written into the agent.</p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {presets.map((p) => {
                const on = selection.subagents.includes(p.name)
                return (
                  <li key={p.name} className={clsx("flex items-start gap-3 rounded-xl px-3 py-2.5 ring-1", on ? "bg-brand-subtle ring-brand-border" : "bg-background ring-border/70")}>
                    <span className="mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-lg bg-secondary text-muted-foreground dark:bg-accent">
                      <Icon name="bot" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium">{p.label}</p>
                      <p className="line-clamp-2 text-[11.5px] text-muted-foreground">{p.description}</p>
                    </div>
                    <Button size="sm" variant="primary" disabled={on} onClick={() => onAddSubagent({ name: p.name, description: p.description, system_prompt: p.system_prompt })}>
                      {on ? "Added" : "Add"}
                    </Button>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        {tab === "computer" && <ComputerTab catalog={catalog} backend={selection.backend} onBackend={onBackend} />}
      </div>

      {picker && (
        <ToolPicker
          integrations={catalog.integrations}
          attached={selection.tools}
          initialId={picker}
          bindAgentId={bindAgentId}
          onClose={() => setPicker(null)}
          onAdd={(tools) => {
            onAddTools(tools)
            setPicker(null)
          }}
        />
      )}
      {creatingSkill && newSkill && (
        <NewSkillDialog attachTo={newSkill.attachTo} draft={newSkill.draft} onCreated={newSkill.onCreated} onClose={() => setCreatingSkill(false)} />
      )}
    </div>
  )
}

function ComputerTab({ catalog, backend, onBackend }: { catalog: Catalog; backend?: BackendDraft; onBackend: (b: BackendDraft) => void }) {
  const on = backend?.type === "sandbox"
  const cfg = on ? (backend as Extract<BackendDraft, { type: "sandbox" }>) : null
  const [snapshot, setSnapshot] = useState(cfg?.snapshot_id ?? (catalog.snapshots.find((s) => /fleet-default|default/i.test(s.name ?? "")) ?? catalog.snapshots[0])?.id ?? "")
  const [scope, setScope] = useState<"thread" | "agent">(cfg?.scope ?? "thread")
  const [policies, setPolicies] = useState<string[]>(cfg?.policy_ids ?? [])
  const [made, setMade] = useState<SandboxPolicy[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const listed = catalog.policies === null ? null : [...catalog.policies, ...made.filter((m) => !catalog.policies?.some((p) => p.id === m.id))]
  const [repaired, setRepaired] = useState(false)
  const hasGraph = (listed ?? []).some((p) => p.graph === true)
  const graphLimited = !repaired && (listed ?? []).some((p) => p.graph === true && p.limits_egress)
  // Mirrors the server's refusal: a computer shared by every user can't carry a profile that
  // injects the running user's own token (the next user's run would re-key it for them).
  const actsAsUser = (listed ?? []).filter((p) => p.acts_as_user && policies.includes(p.id))
  const unsafe = scope === "agent" && actsAsUser.length > 0
  const addGraph = async () => {
    setBusy(true)
    setNote(null)
    try {
      const p = await createGraphProfile()
      setMade((x) => (x.some((y) => y.id === p.id) ? x : [...x, p]))
      setPolicies((x) => (x.includes(p.id) ? x : [...x, p.id]))
      setNote(p.created ? "Created and selected. Apply it with the button below." : graphLimited ? "Host limit removed and selected." : "You already had one: selected it.")
      setRepaired(true)
      void getCatalog(true).catch(() => undefined)
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not create the profile.")
    } finally {
      setBusy(false)
    }
  }
  if (catalog.blocked.snapshots && !catalog.snapshots.length) {
    return <p className="text-[12.5px] text-muted-foreground">Computers aren&apos;t available on this LangSmith install.</p>
  }
  return (
    <div className="flex flex-col gap-4 text-[12.5px]">
      <p className="text-[12px] text-muted-foreground">
        A computer is a LangSmith sandbox (an isolated microVM) the agent can run code and keep files in. Network egress and
        injected credentials are governed by access profiles: yours, or ones shared by your admin.
      </p>
      <label className="flex flex-col gap-1.5 sm:max-w-sm">
        <span className="font-medium">Boot image</span>
        <select value={snapshot} onChange={(e) => setSnapshot(e.target.value)} className={inputClass}>
          {catalog.snapshots.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name ?? s.id}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 font-medium">Scope</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <ChoiceCard checked={scope === "thread"} onChange={() => setScope("thread")} title="Per conversation">
            Each user&apos;s thread gets its own computer. Recommended for shared agents.
          </ChoiceCard>
          <ChoiceCard checked={scope === "agent"} onChange={() => setScope("agent")} title="One shared computer">
            Files persist across <i>every</i> user&apos;s conversations. Only for agents you keep to yourself.
          </ChoiceCard>
        </div>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <span className="font-medium">Access profiles</span>
        {listed === null ? (
          <span className="text-[12px] text-muted-foreground">Managed by your admin in LangSmith (not readable here).</span>
        ) : listed.length === 0 ? (
          <span className="text-[12px] text-muted-foreground">None defined. Default egress rules apply.</span>
        ) : (
          listed.map((p) => (
            <label key={p.id} className="flex w-fit cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-accent/60">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[var(--brand)]"
                checked={policies.includes(p.id)}
                onChange={(e) => setPolicies((x) => (e.target.checked ? [...x, p.id] : x.filter((y) => y !== p.id)))}
              />
              {p.name ?? p.id}
            </label>
          ))
        )}
        {listed !== null && !hasGraph && (
          <div className="mt-1 flex flex-col items-start gap-2 rounded-xl bg-muted p-3 dark:bg-accent/40">
            <span className="text-[12px] text-muted-foreground">
              Let code on this computer call Microsoft Graph as the person running the agent. The token is added on the way out and never
              enters the computer.
            </span>
            <Button size="sm" disabled={busy} onClick={addGraph}>
              {busy ? "Creating…" : "Create my Microsoft Graph profile"}
            </Button>
          </div>
        )}
        {graphLimited && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-destructive">
            Your Graph profile limits the computer to Microsoft hosts (no PyPI, GitHub, npm).
            <Button size="sm" disabled={busy} onClick={addGraph}>
              Remove host limit
            </Button>
          </div>
        )}
        {note && <span className="text-[12px] text-muted-foreground">{note}</span>}
        {unsafe && (
          <span className="text-[12px] text-destructive">
            {actsAsUser.map((p) => p.name ?? p.id).join(", ")} use{actsAsUser.length === 1 ? "s" : ""} each person&apos;s own connection, so
            {actsAsUser.length === 1 ? " it needs" : " they need"} a per-conversation computer. Switch the scope or untick the profile.
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="primary" disabled={!snapshot || unsafe} onClick={() => onBackend({ type: "sandbox", scope, snapshot_id: snapshot, policy_ids: policies })}>
          {on ? "Update computer" : "Give it a computer"}
        </Button>
        {on && (
          <Button onClick={() => onBackend({ type: "state" })}>
            Remove computer
          </Button>
        )}
      </div>
    </div>
  )
}

/** A radio choice as a selectable card: the whole card is the label. */
export function ChoiceCard({
  checked,
  onChange,
  title,
  children,
  name,
}: {
  checked: boolean
  onChange: () => void
  title: string
  children: React.ReactNode
  name?: string
}) {
  return (
    <label
      className={clsx(
        "flex cursor-pointer items-start gap-2.5 rounded-xl px-3.5 py-3 ring-1 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
        checked ? "bg-brand-subtle ring-brand-border" : "bg-background ring-border/70 hover:bg-accent/60",
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="mt-0.5 h-3.5 w-3.5 flex-none accent-[var(--brand)]" />
      <span className="text-[12.5px] leading-relaxed">
        <span className="block font-medium text-foreground">{title}</span>
        <span className="text-muted-foreground">{children}</span>
      </span>
    </label>
  )
}
