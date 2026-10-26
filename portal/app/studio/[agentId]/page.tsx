"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { Suspense, useCallback, useEffect, useState } from "react"

import { BuilderOnly } from "@/components/builder-only"
import { CatalogPanel } from "@/components/build/catalog-panel"
import { ChatPanel } from "@/components/chat-panel"
import { ErrorNote } from "@/components/error-note"
import { inputClass, RailEditor } from "@/components/rail/RailEditor"
import { BackendSection } from "@/components/rail/sections/backend"
import { InstructionsSection } from "@/components/rail/sections/instructions"
import { attachedSkills, SkillsSection } from "@/components/rail/sections/skills"
import { SubagentsSection } from "@/components/rail/sections/subagents"
import { ToolsSection } from "@/components/rail/sections/tools"
import { Shell, useMe } from "@/components/shell"
import { AgentAvatar, Button, buttonClass, Icon, Mono, SectionCard, surfaceClass } from "@/components/ui"
import { addSkill, getAgent, getCatalog, putBackend, putModel, putSubagent, putTools, removeSkill, updateMeta, type BackendDraft, type ToolDraft } from "@/lib/api"
import type { Agent, Catalog } from "@/lib/types"

function toolDrafts(a: Agent): ToolDraft[] {
  return (a.tools?.tools ?? []).map((t) => ({
    name: t.name,
    mcp_server_url: t.mcp_server_url ?? "",
    mcp_server_name: t.mcp_server_name ?? "",
    require_approval: Boolean((a.tools?.interrupt_config ?? {})[t.name]),
  }))
}

function backendDraft(a: Agent): BackendDraft {
  if (a.backend?.type !== "sandbox") return { type: "state" }
  const c = a.backend.sandbox_config ?? {}
  return { type: "sandbox", scope: c.scope === "agent" ? "agent" : "thread", snapshot_id: c.snapshot_id, policy_ids: c.policy_ids ?? [] }
}

/**
 * BUILD › one agent. Main column: what the agent is (each section saves on its own),
 * then what you can add to it (LangSmith-resolved for you). Right: a test chat on
 * `test_run` threads, which stay out of everyone's history.
 */
function BuildAgent() {
  const { agentId } = useParams<{ agentId: string }>()
  const { me } = useMe()
  const [agent, setAgent] = useState<Agent | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [testKey, setTestKey] = useState(0)

  useEffect(() => {
    getAgent(agentId).then(setAgent).catch(setError)
    getCatalog().then(setCatalog).catch(setError)
  }, [agentId])

  /** Catalog actions write straight to Fleet; any refusal is LangSmith's to explain. */
  const apply = useCallback(async (fn: () => Promise<Agent>) => {
    setError(null)
    try {
      setAgent(await fn())
    } catch (e) {
      setError(e)
    }
  }, [])

  if (me && !me.can_build) return <BuilderOnly me={me} what="Building agents" />
  if (!agent || !catalog) return error ? <ErrorNote error={error} /> : <p className="text-[13px] text-muted-foreground">Loading…</p>
  if (agent.access_level !== "write")
    return (
      <p className="text-[13px] text-muted-foreground">
        You can use this agent but not edit it. <Link className="text-brand underline" href={`/agents/${agent.id}`}>Open it in Use</Link>, or clone it to customize.
      </p>
    )

  const identity = agent.permissions?.identity === "shared" ? "shared" : "personal"
  const model = catalog.models.find((m) => m.id === agent.model?.id)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link href="/studio" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground">
            <Icon name="chevron" className="h-3 w-3 rotate-180" />
            Build
          </Link>
          <div className="mt-1.5 flex min-w-0 items-center gap-3">
            <AgentAvatar id={agent.id} name={agent.name} size="lg" />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{agent.name}</h1>
              <p className="text-[12.5px] text-muted-foreground">
                {identity === "shared" ? "Tools use this agent's own connections" : "Tools act as each user"} ·{" "}
                {agent.permissions?.visibility === "tenant" ? `published to workspace (${agent.permissions.tenant_access_level})` : "private"} · revision{" "}
                <Mono className="text-[11px]">{agent.revision?.slice(0, 8) ?? "—"}</Mono>
              </p>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/agents/${agent.id}`} className={buttonClass("default")}>
            Open in Use
          </Link>
          {agent.is_owner && (
            <Link href={`/publish/${agent.id}`} className={buttonClass("primary")}>
              Publish…
            </Link>
          )}
        </div>
      </div>
      <ErrorNote error={error} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <SectionCard title="Configuration" description="Each section saves on its own." bodyClassName="pt-2 pb-1">
            <div className="flex flex-col divide-y divide-border/60">
              <MetaSection agent={agent} onSaved={setAgent} />
              <div className="flex items-center justify-between gap-2 px-5 py-3.5 text-[13px]">
                <span className="font-medium">Model</span>
                <span className="truncate text-[12px] text-muted-foreground" title="Change it in Capabilities › Models: only models your workspace enabled for Fleet appear there">
                  {model?.display_name ?? agent.model?.id ?? "—"}
                </span>
              </div>
              <InstructionsSection agent={agent} onSaved={setAgent} />
              <ToolsSection agent={agent} ctx={catalog} onSaved={setAgent} />
              <SkillsSection agent={agent} ctx={catalog} onSaved={setAgent} />
              <SubagentsSection agent={agent} onSaved={setAgent} />
              <BackendSection agent={agent} onSaved={setAgent} />
            </div>
          </SectionCard>

          <SectionCard title="Capabilities" description="Add from what LangSmith lets you build with. Each change saves at once.">
            <CatalogPanel
              catalog={catalog}
              identity={identity}
              bindAgentId={identity === "shared" ? agent.id : undefined}
              selection={{ modelId: agent.model?.id, tools: toolDrafts(agent), skills: attachedSkills(agent), subagents: (agent.subagents ?? []).map((s) => s.name), backend: backendDraft(agent) }}
              onModel={(id) => apply(() => putModel(agent.id, id))}
              onAddTools={(ts) => apply(() => putTools(agent.id, [...toolDrafts(agent), ...ts.filter((t) => !toolDrafts(agent).some((x) => x.name === t.name))]))}
              onSkill={(h, on) => apply(() => (on ? addSkill(agent.id, h) : removeSkill(agent.id, h)))}
              onAddSubagent={(s) => apply(() => putSubagent(agent.id, s))}
              onBackend={(b) => apply(() => putBackend(agent.id, b.type === "sandbox" ? { type: "sandbox", scope: b.scope, snapshot_id: b.snapshot_id, policy_ids: b.policy_ids } : { type: "state" }))}
              newSkill={{
                attachTo: agent.id,
                onCreated: (r) => {
                  getCatalog(true).then(setCatalog).catch(setError)
                  if (r.agent) setAgent(r.agent)
                },
              }}
            />
          </SectionCard>
        </div>

        <aside className={`${surfaceClass} flex h-[36rem] flex-col p-4 xl:sticky xl:top-20 xl:h-[calc(100dvh-7rem)]`} aria-label="Test chat">
          <div className="mb-1 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold">
              <Icon name="chat" />
              Test
            </p>
            <Button size="sm" variant="ghost" onClick={() => setTestKey((k) => k + 1)}>
              Reset
            </Button>
          </div>
          <p className="mb-2 text-[11.5px] text-muted-foreground">Test runs stay out of history and usage analytics.</p>
          <ChatPanel key={testKey} agent={agent} threadId={null} testRun emptyHint={<p className="m-auto text-[12.5px] text-muted-foreground">Try your agent here.</p>} />
        </aside>
      </div>
    </div>
  )
}

function MetaSection({ agent, onSaved }: { agent: Agent; onSaved: (a: Agent) => void }) {
  const [name, setName] = useState(agent.name)
  const [desc, setDesc] = useState(agent.description ?? "")
  useEffect(() => {
    setName(agent.name)
    setDesc(agent.description ?? "")
  }, [agent.name, agent.description])
  return (
    <RailEditor
      label="Name & description"
      summary={agent.name}
      dirty={name !== agent.name || desc !== (agent.description ?? "")}
      onCancel={() => {
        setName(agent.name)
        setDesc(agent.description ?? "")
      }}
      onSave={async () => onSaved(await updateMeta(agent.id, name.trim(), desc))}
    >
      <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
      <input className={inputClass} value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="Description" />
    </RailEditor>
  )
}

export default function Page() {
  return (
    <Shell max="max-w-7xl">
      <Suspense fallback={null}>
        <BuildAgent />
      </Suspense>
    </Shell>
  )
}
