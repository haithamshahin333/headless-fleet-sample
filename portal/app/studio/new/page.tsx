"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { BuilderOnly } from "@/components/builder-only"
import { CatalogPanel, ChoiceCard } from "@/components/build/catalog-panel"
import { ErrorNote } from "@/components/error-note"
import { inputClass } from "@/components/rail/RailEditor"
import { Shell, useMe } from "@/components/shell"
import { AgentAvatar, Button, Icon, SectionCard, surfaceClass, type IconName } from "@/components/ui"
import { createAgent, getCatalog, type AgentDraft } from "@/lib/api"
import { humanizeTool } from "@/lib/humanize"
import type { Catalog } from "@/lib/types"

/**
 * BUILD › New agent. A local draft composed from the catalog, created with ONE
 * full-spec POST — the agent is born with its tools, skills, subagents and computer
 * instead of being created empty and patched five times.
 *
 * Layout: a centred composer (Basics, then Capabilities) and a sticky summary that
 * holds the Create button, so what you are about to create is always in view.
 */
function NewAgent() {
  const router = useRouter()
  const { me } = useMe()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [d, setD] = useState<AgentDraft>({ name: "", description: "", model_id: "", system_prompt: "", identity: "personal", tools: [], skills: [], subagents: [], backend: { type: "state" } })

  useEffect(() => {
    getCatalog()
      .then((c) => {
        setCatalog(c)
        setD((x) => ({ ...x, model_id: x.model_id || c.default_model_id || c.models[0]?.id || "" }))
      })
      .catch(setError)
  }, [])

  if (me && !me.can_build) return <BuilderOnly me={me} what="Building agents" />
  if (!catalog) return error ? <ErrorNote error={error} /> : <p className="text-[13px] text-muted-foreground">Loading what you can build with…</p>

  const model = catalog.models.find((m) => m.id === d.model_id)
  const valid = !!(d.name.trim() && d.model_id)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const a = await createAgent({ ...d, name: d.name.trim() })
      router.push(`/studio/${a.id}`)
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/studio" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground">
          <Icon name="chevron" className="h-3 w-3 rotate-180" />
          Build
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">New agent</h1>
        <p className="mt-1.5 text-[13.5px] text-muted-foreground">Describe it, pick what it can use, then create it. Nothing is created until you press Create.</p>
      </div>
      <ErrorNote error={error} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <SectionCard title="Basics" description="What it is called, whose accounts its tools use, and how it behaves.">
            <div className="flex flex-col gap-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-[12.5px] font-medium">
                  Name
                  <input className={inputClass} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Sales research assistant" autoFocus />
                </label>
                <label className="flex flex-col gap-1.5 text-[12.5px] font-medium">
                  Description
                  <input className={inputClass} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="What it helps with" />
                </label>
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-[12.5px] font-medium">Whose accounts do tools use?</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <ChoiceCard name="identity" checked={d.identity === "personal"} onChange={() => setD({ ...d, identity: "personal" })} title="Each user's own">
                    The agent acts as whoever runs it. Each user connects their own accounts.
                  </ChoiceCard>
                  <ChoiceCard name="identity" checked={d.identity === "shared"} onChange={() => setD({ ...d, identity: "shared" })} title="The agent's own">
                    You connect accounts once, and everyone who runs it uses them.
                  </ChoiceCard>
                </div>
                <p className="text-[11.5px] text-muted-foreground">This can&apos;t be changed after the agent is created.</p>
              </fieldset>

              <label className="flex flex-col gap-1.5 text-[12.5px] font-medium">
                Instructions
                <textarea className={`${inputClass} min-h-32 leading-relaxed`} value={d.system_prompt} onChange={(e) => setD({ ...d, system_prompt: e.target.value })} placeholder="How should this agent behave?" />
                <span className="text-[11.5px] font-normal text-muted-foreground">Guidance, not a guardrail. Use “asks first” on tools to enforce.</span>
              </label>
            </div>
          </SectionCard>

          <SectionCard title="Capabilities" description="What LangSmith lets you build with, resolved for you. Anything your admin restricts shows as locked.">
            <CatalogPanel
              catalog={catalog}
              identity={d.identity}
              selection={{ modelId: d.model_id, tools: d.tools ?? [], skills: d.skills ?? [], subagents: (d.subagents ?? []).map((s) => s.name), backend: d.backend }}
              onModel={(id) => setD((x) => ({ ...x, model_id: id }))}
              onAddTools={(ts) => setD((x) => ({ ...x, tools: [...(x.tools ?? []), ...ts.filter((t) => !(x.tools ?? []).some((y) => y.name === t.name))] }))}
              onSkill={(h, on) => setD((x) => ({ ...x, skills: on ? [...(x.skills ?? []), h] : (x.skills ?? []).filter((s) => s !== h) }))}
              onAddSubagent={(s) => setD((x) => ({ ...x, subagents: [...(x.subagents ?? []), s] }))}
              onBackend={(b) => setD((x) => ({ ...x, backend: b }))}
              newSkill={{
                draft: true,
                onCreated: (r) => {
                  getCatalog(true).then(setCatalog).catch(setError)
                  setD((x) => ({ ...x, skills: [...(x.skills ?? []).filter((h) => h !== r.skill.id), r.skill.id] }))
                },
              }}
            />
          </SectionCard>
        </div>

        <aside className={`${surfaceClass} flex flex-col lg:sticky lg:top-20`} aria-label="Your agent">
          <div className="flex items-center gap-3 p-5 pb-4">
            <AgentAvatar id="new" name={d.name} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold tracking-tight">{d.name.trim() || "Untitled agent"}</p>
              <p className="line-clamp-2 text-[12px] text-muted-foreground">{d.description?.trim() || "No description yet"}</p>
            </div>
          </div>

          <dl className="flex flex-col divide-y divide-border/60 border-y border-border/60 text-[12.5px]">
            <Row icon="chip" label="Model">
              {model?.display_name ?? <span className="text-destructive">Choose one</span>}
            </Row>
            <Row icon={d.identity === "shared" ? "swap" : "user"} label="Accounts">
              {d.identity === "shared" ? "The agent's own" : "Each user's own"}
            </Row>
            <Row icon="plug" label="Tools" stack={(d.tools ?? []).length > 0}>
              {(d.tools ?? []).length === 0 ? (
                <span className="text-muted-foreground">None</span>
              ) : (
                <ul className="mt-1 flex flex-col gap-1">
                  {(d.tools ?? []).map((t) => (
                    <li key={t.name} className="flex items-center gap-2 rounded-lg bg-muted px-2 py-1.5 dark:bg-accent/40">
                      <span className="min-w-0 flex-1 truncate" title={`${t.name} · ${t.mcp_server_name}`}>
                        {humanizeTool(t.name)}
                      </span>
                      <label title="Ask the user before each call" className="flex flex-none cursor-pointer items-center gap-1 text-[11px] text-muted-foreground">
                        <input
                          type="checkbox"
                          className="h-3 w-3 accent-[var(--brand)]"
                          checked={!!t.require_approval}
                          onChange={(e) => setD({ ...d, tools: (d.tools ?? []).map((x) => (x.name === t.name ? { ...x, require_approval: e.target.checked } : x)) })}
                        />
                        asks first
                      </label>
                      <button
                        type="button"
                        aria-label={`Remove ${t.name}`}
                        className="flex-none rounded text-muted-foreground hover:text-destructive"
                        onClick={() => setD({ ...d, tools: (d.tools ?? []).filter((x) => x.name !== t.name) })}
                      >
                        <Icon name="x" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Row>
            <Row icon="sparkle" label="Skills">
              {(d.skills ?? []).length ? (d.skills ?? []).map((h) => catalog.skills.find((s) => s.id === h)?.name ?? h).join(", ") : <span className="text-muted-foreground">None</span>}
            </Row>
            <Row icon="bot" label="Subagents">
              {(d.subagents ?? []).length === 0 ? (
                <span className="text-muted-foreground">None</span>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {(d.subagents ?? []).map((s) => (
                    <span key={s.name} className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-2 pr-1 text-[11.5px] dark:bg-accent/40">
                      {s.name}
                      <button type="button" aria-label={`Remove ${s.name}`} className="text-muted-foreground hover:text-destructive" onClick={() => setD({ ...d, subagents: (d.subagents ?? []).filter((x) => x.name !== s.name) })}>
                        <Icon name="x" className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </span>
              )}
            </Row>
            <Row icon="monitor" label="Computer">
              {d.backend?.type === "sandbox" ? (d.backend.scope === "agent" ? "One shared computer" : "One per conversation") : <span className="text-muted-foreground">None</span>}
            </Row>
          </dl>

          <div className="flex flex-col gap-2 p-5">
            <Button variant="primary" size="lg" className="w-full" disabled={!valid || busy} onClick={create}>
              {busy ? "Creating…" : "Create agent"}
            </Button>
            <p className="text-center text-[11.5px] text-muted-foreground">{d.name.trim() ? "Private to you until you publish it." : "Give it a name to create it."}</p>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Row({ icon, label, stack, children }: { icon: IconName; label: string; stack?: boolean; children: React.ReactNode }) {
  return (
    <div className={stack ? "flex flex-col gap-1 px-5 py-2.5" : "flex gap-3 px-5 py-2.5"}>
      <dt className="flex w-24 flex-none items-center gap-1.5 text-muted-foreground">
        <Icon name={icon} />
        {label}
      </dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  )
}

export default function Page() {
  return (
    <Shell>
      <NewAgent />
    </Shell>
  )
}
