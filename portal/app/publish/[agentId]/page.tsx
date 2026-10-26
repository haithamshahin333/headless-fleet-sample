"use client"

import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { Suspense, useEffect, useMemo, useState } from "react"

import { BuilderOnly } from "@/components/builder-only"
import { ErrorNote } from "@/components/error-note"
import { inputClass } from "@/components/rail/RailEditor"
import { Shell, useMe } from "@/components/shell"
import { Button } from "@/components/ui"
import { archiveAgent, deleteAgent, getAgent, getReadiness, putPermissions, resolveUsers, searchUsers, unarchiveAgent } from "@/lib/api"
import type { AccessLevel, Agent, Readiness, User } from "@/lib/types"

const LEVELS: [AccessLevel, string, string][] = [
  ["read", "Can clone", "see it and make their own copy"],
  ["run", "Can run", "use it, without changing it"],
  ["write", "Can edit", "change its configuration"],
]
const label = (l: AccessLevel) => LEVELS.find((x) => x[0] === l)?.[1] ?? l

type Draft = { visibility: "user" | "tenant"; tenant_access_level: AccessLevel; people: Record<string, AccessLevel> }

function draftOf(a: Agent): Draft {
  const s = a.permissions?.shared_users ?? {}
  const people: Record<string, AccessLevel> = {}
  for (const id of s.read ?? []) people[id] = "read"
  for (const id of s.run ?? []) people[id] = "run"
  for (const id of [...(s.write ?? []), ...(s.update ?? [])]) people[id] = "write"
  return { visibility: a.permissions?.visibility === "tenant" ? "tenant" : "user", tenant_access_level: a.permissions?.tenant_access_level ?? "run", people }
}

/** PUBLISH › one agent. Owner-only in LangSmith; Fleet answers 403 to anyone else. */
function ManageAccess() {
  const { agentId } = useParams<{ agentId: string }>()
  const router = useRouter()
  const { me } = useMe()
  const [agent, setAgent] = useState<Agent | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [names, setNames] = useState<Record<string, User>>({})
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<User[]>([])
  const [addLevel, setAddLevel] = useState<AccessLevel>("run")

  useEffect(() => {
    // Ignore a stale response (StrictMode double-invokes effects in dev): a late load
    // must never overwrite edits the owner has already made.
    let cancelled = false
    getAgent(agentId)
      .then((a) => {
        if (cancelled) return
        setAgent(a)
        const d = draftOf(a)
        setDraft(d)
        resolveUsers(Object.keys(d.people)).then((r) => setNames(Object.fromEntries(r.items.map((u) => [u.id, u])))).catch(() => {})
      })
      .catch((e) => !cancelled && setError(e))
    getReadiness(agentId).then((r) => !cancelled && setReadiness(r)).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [agentId])

  useEffect(() => {
    if (q.trim().length < 2) return setHits([])
    const t = setTimeout(() => searchUsers(q.trim()).then((r) => setHits(r.items)).catch(() => setHits([])), 250)
    return () => clearTimeout(t)
  }, [q])

  const upd = (f: (d: Draft) => Draft) => setDraft((d) => (d ? f(d) : d))
  const dirty = useMemo(() => agent && draft && JSON.stringify(draftOf(agent)) !== JSON.stringify(draft), [agent, draft])

  if (me && !me.can_build) return <BuilderOnly me={me} what="Publishing" className="m-6" />
  if (!agent || !draft) return error ? <ErrorNote error={error} /> : <p className="text-[13px] text-muted-foreground">Loading…</p>
  if (!agent.is_owner)
    return <p className="text-[13px] text-muted-foreground">Only the owner of “{agent.name}” can change who has access ({agent.owner?.name ?? "someone else"}).</p>

  const sharedBeyondOwner = draft.visibility === "tenant" || Object.keys(draft.people).length > 0
  const agentScopedComputer = agent.backend?.type === "sandbox" && agent.backend.sandbox_config?.scope === "agent"
  const unbound = readiness?.identity === "shared" ? readiness.providers.filter((p) => p.status === "owner_must_connect") : []

  async function save() {
    if (!draft || !agent) return
    setBusy(true)
    setError(null)
    setSaved(false)
    const buckets = { read: [] as string[], run: [] as string[], write: [] as string[] }
    for (const [id, l] of Object.entries(draft.people)) buckets[l].push(id)
    try {
      const a = await putPermissions(agent.id, { visibility: draft.visibility, tenant_access_level: draft.tenant_access_level, shared_users: buckets })
      setAgent(a)
      setDraft(draftOf(a))
      setSaved(true)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] text-muted-foreground">
            <Link href="/publish" className="hover:underline">
              Publish
            </Link>{" "}
            ›
          </p>
          <h1 className="text-xl font-semibold tracking-tight">Who can use “{agent.name}”</h1>
        </div>
        <div className="flex gap-2">
          <Link href={`/studio/${agent.id}`} className="inline-flex h-7 items-center rounded-lg border border-border/80 bg-card px-2.5 text-xs font-medium shadow-card hover:bg-accent">
            Edit in Build
          </Link>
          <Link href={`/agents/${agent.id}`} className="inline-flex h-7 items-center rounded-lg border border-border/80 bg-card px-2.5 text-xs font-medium shadow-card hover:bg-accent">
            Open in Use
          </Link>
        </div>
      </div>

      {sharedBeyondOwner && agentScopedComputer && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12.5px]">
          ⚠ This agent has <b>one shared computer</b>: files and running processes persist across every user&apos;s conversations, and any
          access profile that injects a user&apos;s own credentials would hand each runner&apos;s token to that shared machine. Switch its
          computer to “per conversation” in Build before sharing.
        </p>
      )}
      {sharedBeyondOwner && unbound.length > 0 && (
        <p className="rounded-xl border border-brand-border bg-brand-subtle px-3 py-2 text-[12.5px]">
          This agent uses <b>its own connections</b>, and {unbound.map((p) => p.slug).join(", ")} {unbound.length === 1 ? "isn't" : "aren't"} bound yet —
          people you share with will be stopped at those tools. Bind them from the agent&apos;s chat or Build page first.
        </p>
      )}

      <section className="rounded-2xl bg-card p-5 shadow-card ring-1 ring-border/60">
        <h2 className="mb-2 text-[13.5px] font-semibold">Workspace</h2>
        <div className="flex flex-col gap-2 text-[13px]">
          <label className="flex items-center gap-2">
            <input type="radio" checked={draft.visibility === "user"} onChange={() => upd((d) => ({ ...d, visibility: "user" }))} />
            Only people listed below
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" checked={draft.visibility === "tenant"} onChange={() => upd((d) => ({ ...d, visibility: "tenant" }))} />
            Everyone in {me?.current_workspace?.name ?? "the workspace"}
            <select
              disabled={draft.visibility !== "tenant"}
              value={draft.tenant_access_level}
              onChange={(e) => upd((d) => ({ ...d, tenant_access_level: e.target.value as AccessLevel }))}
              className="h-7 rounded-lg border border-input bg-background px-2 text-[12px] disabled:opacity-50"
            >
              {LEVELS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-2xl bg-card p-5 shadow-card ring-1 ring-border/60">
        <h2 className="mb-2 text-[13.5px] font-semibold">People</h2>
        <div className="relative mb-3 flex gap-2">
          <input className={`${inputClass} flex-1`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a colleague by name or email…" aria-label="Find a colleague" />
          <select value={addLevel} onChange={(e) => setAddLevel(e.target.value as AccessLevel)} className="h-8 rounded-lg border border-input bg-background px-2 text-[12px]">
            {LEVELS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          {hits.length > 0 && (
            <ul className="absolute left-0 top-9 z-20 w-80 rounded-xl bg-popover p-1 shadow-pop ring-1 ring-border/60">
              {hits
                .filter((u) => u.id !== agent.owner_id)
                .map((u) => (
                  <li key={u.id}>
                    <button
                      className="w-full rounded px-2 py-1 text-left text-[12px] hover:bg-accent"
                      onClick={() => {
                        setNames((n) => ({ ...n, [u.id]: u }))
                        upd((d) => ({ ...d, people: { ...d.people, [u.id]: addLevel } }))
                        setQ("")
                        setHits([])
                      }}
                    >
                      {u.name ?? u.email} <span className="text-muted-foreground">{u.name ? u.email : ""}</span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
        <ul className="flex flex-col divide-y text-[13px]">
          <li className="flex items-center gap-2 py-1.5">
            <span className="flex-1">{agent.owner?.name ?? "You"} (owner)</span>
            <span className="text-[12px] text-muted-foreground">Full control</span>
          </li>
          {Object.entries(draft.people).map(([id, lvl]) => (
            <li key={id} className="flex items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1 truncate">{names[id]?.name ?? names[id]?.email ?? id}</span>
              <select
                value={lvl}
                onChange={(e) => upd((d) => ({ ...d, people: { ...d.people, [id]: e.target.value as AccessLevel } }))}
                className="h-7 rounded-lg border border-input bg-background px-2 text-[12px]"
              >
                {LEVELS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <button
                className="text-[12px] text-muted-foreground hover:text-destructive"
                onClick={() => {
                  upd((d) => {
                    const people = { ...d.people }
                    delete people[id]
                    return { ...d, people }
                  })
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl bg-card p-5 shadow-card ring-1 ring-border/60 text-[12.5px]">
        <h2 className="mb-2 text-[13.5px] font-semibold">What this means</h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
          {draft.visibility === "tenant" && <li>Everyone in the workspace: {LEVELS.find((l) => l[0] === draft.tenant_access_level)?.[2]}.</li>}
          {Object.entries(draft.people).map(([id, lvl]) => (
            <li key={id}>
              {names[id]?.name ?? names[id]?.email ?? id}: {label(lvl).toLowerCase()} — {LEVELS.find((l) => l[0] === lvl)?.[2]}.
            </li>
          ))}
          <li>
            Tools run as{" "}
            {agent.permissions?.identity === "shared" ? "this agent's own connections, for everyone" : "each person, with their own connected accounts"} (fixed when the agent was created).
          </li>
          <li>Everyone&apos;s conversations stay private to them.</li>
        </ul>
      </section>

      <ErrorNote error={error} />
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={!dirty || busy} onClick={save}>
          {busy ? "Saving…" : "Save access"}
        </Button>
        {saved && !dirty && <span className="text-[12px] text-muted-foreground">Saved — LangSmith now enforces this.</span>}
      </div>

      <section className="mt-4 rounded-xl p-4 ring-1 ring-border/60">
        <h2 className="mb-1 text-[13.5px] font-semibold">Retire</h2>
        <p className="mb-3 text-[12px] text-muted-foreground">Archiving hides the agent and stops it running; you can restore it. Deleting is permanent.</p>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              try {
                setAgent(agent.is_archived ? await unarchiveAgent(agent.id) : await archiveAgent(agent.id))
              } catch (e) {
                setError(e)
              }
            }}
          >
            {agent.is_archived ? "Restore" : "Archive"}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={async () => {
              if (!confirm(`Delete “${agent.name}” permanently?`)) return
              try {
                await deleteAgent(agent.id)
                router.push("/publish")
              } catch (e) {
                setError(e)
              }
            }}
          >
            Delete
          </Button>
        </div>
      </section>
    </div>
  )
}

export default function Page() {
  return (
    <Shell>
      <Suspense fallback={null}>
        <ManageAccess />
      </Suspense>
    </Shell>
  )
}
