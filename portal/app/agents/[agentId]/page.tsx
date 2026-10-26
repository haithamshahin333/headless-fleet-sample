"use client"

import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { Suspense, useCallback, useEffect, useState } from "react"

import { ChatPanel } from "@/components/chat-panel"
import { ConnectionGate } from "@/components/connection-gate"
import { AccessBadge, ErrorNote } from "@/components/error-note"
import { FilesDrawer } from "@/components/files-drawer"
import { Shell, useMe } from "@/components/shell"
import { ThreadList } from "@/components/thread-list"
import { AgentAvatar, Button, buttonClass, Icon, Mono, Tag } from "@/components/ui"
import { cloneAgent, getAgent, getThreads } from "@/lib/api"
import { humanizeTool } from "@/lib/humanize"
import type { Agent, ThreadSummary } from "@/lib/types"

/** What an agent can do, read-only — consumers should know before they ask. */
function Capabilities({ agent }: { agent: Agent }) {
  const tools = agent.tools?.tools ?? []
  const skills = Object.entries(agent.files ?? {}).filter(([, f]) => f.type === "skill").map(([p, f]) => f.repo_handle ?? p.replace("skills/", ""))
  const approval = agent.tools?.interrupt_config ?? {}
  return (
    <details className="relative">
      <summary className={`${buttonClass("default", "sm")} cursor-pointer list-none`}>What it can do</summary>
      <div className="absolute right-0 z-30 mt-2 w-80 rounded-2xl bg-popover p-4 text-[12px] shadow-pop ring-1 ring-border/60">
        <p className="mb-1 font-semibold">Tools</p>
        {tools.length ? (
          <ul className="mb-2 flex flex-col gap-0.5">
            {tools.map((t) => (
              <li key={t.name} className="flex justify-between gap-2">
                <span className="truncate">{humanizeTool(t.name, null)}</span>
                <span className="flex-none text-muted-foreground">{t.mcp_server_name}{approval[t.name] ? " · asks first" : ""}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-2 text-muted-foreground">No tools.</p>
        )}
        <p className="mb-1 font-semibold">Skills</p>
        <p className="mb-2 text-muted-foreground">{skills.length ? skills.join(", ") : "None."}</p>
        <p className="mb-1 font-semibold">Subagents</p>
        <p className="mb-2 text-muted-foreground">{agent.subagents?.length ? agent.subagents.map((s) => s.name).join(", ") : "None."}</p>
        <p className="mb-1 font-semibold">Computer</p>
        <p className="text-muted-foreground">
          {agent.backend?.type === "sandbox" ? `Yes — ${agent.backend.sandbox_config?.scope === "agent" ? "one shared computer" : "a fresh computer per conversation"}` : "No."}
        </p>
      </div>
    </details>
  )
}

function AgentUse() {
  const { agentId } = useParams<{ agentId: string }>()
  const search = useSearchParams()
  const router = useRouter()
  const threadId = search.get("thread")
  const { me, bump } = useMe()

  const [agent, setAgent] = useState<Agent | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [ready, setReady] = useState(true)
  const [files, setFiles] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getAgent(agentId).then(setAgent).catch(setError)
  }, [agentId])

  const loadThreads = useCallback(
    (more?: string) =>
      getThreads(agentId, more)
        .then((p) => {
          setThreads((t) => (more ? [...t, ...p.items] : p.items))
          setCursor(p.next_cursor ?? null)
        })
        .catch(() => {}),
    [agentId],
  )
  useEffect(() => {
    void loadThreads()
  }, [loadThreads])

  const onSettled = useCallback(() => {
    void loadThreads()
    bump()
  }, [loadThreads, bump])
  const onThreadCreated = useCallback((id: string) => router.replace(`/agents/${agentId}?thread=${id}`), [router, agentId])

  if (error) return <ErrorNote error={error} className="m-6" />
  if (!agent) return <p className="m-6 text-[13px] text-muted-foreground">Loading agent…</p>

  const canEdit = !!me?.can_build && agent.access_level === "write"
  const canClone = !!me?.can_build
  const slug = agent.backend?.type === "sandbox" ? agent.backend.sandbox_config?.sandbox_slug : undefined

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-72 flex-none overflow-y-auto border-r border-border/60 bg-sidebar/60 p-3 md:block">
        <ThreadList agentId={agent.id} threads={threads} selected={threadId} hasMore={!!cursor} onMore={() => cursor && loadThreads(cursor)} />
      </aside>

      <section className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-4 px-4 py-5 sm:px-8">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <AgentAvatar id={agent.id} name={agent.name} size="sm" />
              <h1 className="truncate text-lg font-semibold tracking-tight">{agent.name}</h1>
              <AccessBadge level={agent.access_level} owner={agent.is_owner} />
              {agent.backend?.type === "sandbox" && (
                <Tag className="h-5 text-[10.5px]">
                  <Icon name="monitor" className="h-3 w-3" />
                  computer
                </Tag>
              )}
            </div>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {agent.is_owner ? "Your agent" : `By ${agent.owner?.name ?? "a colleague"}`}
              {agent.description ? ` · ${agent.description}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Capabilities agent={agent} />
            {slug && (
              <Button size="sm" onClick={() => setFiles((f) => !f)}>
                Files
              </Button>
            )}
            {canClone && (
              <Button
                size="sm"
                disabled={busy}
                title="Make your own copy to customize"
                onClick={async () => {
                  setBusy(true)
                  try {
                    const c = await cloneAgent(agent.id, `${agent.name} (copy)`)
                    router.push(`/studio/${c.id}`)
                  } catch (e) {
                    setError(e)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Clone
              </Button>
            )}
            {canEdit && (
              <Link href={`/studio/${agent.id}`} className={buttonClass("default", "sm")}>
                Edit in Build
              </Link>
            )}
          </div>
        </header>

        <ConnectionGate agent={agent} onReady={setReady} />

        <ChatPanel
          agent={agent}
          threadId={threadId}
          blocked={ready ? null : "Connect the accounts above to start."}
          onThreadCreated={onThreadCreated}
          onSettled={onSettled}
          emptyHint={
            <div className="m-auto max-w-[52ch] py-10 text-center">
              <p className="text-[14px] font-medium">Start a conversation with {agent.name}</p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                Your conversations are private to you. Runs as{" "}
                {agent.permissions?.identity === "shared" ? "the agent's shared connections" : "you, with your own connected accounts"}.
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Agent <Mono className="text-[10.5px]">{agent.id.slice(0, 8)}</Mono>
              </p>
            </div>
          }
        />
      </section>

      {files && slug && <FilesDrawer slug={slug} onClose={() => setFiles(false)} />}
    </div>
  )
}

export default function Page() {
  return (
    <Shell wide>
      <Suspense fallback={null}>
        <AgentUse />
      </Suspense>
    </Shell>
  )
}
