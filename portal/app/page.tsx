"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { AgentCard } from "@/components/agent-card"
import { ErrorNote } from "@/components/error-note"
import { Shell, useMe } from "@/components/shell"
import { ago, StatusDot, threadTitle } from "@/components/thread-list"
import { buttonClass, Icon, surfaceClass } from "@/components/ui"
import { getAgents, getInbox } from "@/lib/api"
import type { Agent, ThreadPage } from "@/lib/types"

/**
 * USE — the consumer experience. Everything here is what LangSmith says THIS user can
 * run: agents shared with them, agents published to the workspace, their own. No
 * editing on this side; builders go to Build.
 */
function UseHome() {
  const { me } = useMe()
  const [agents, setAgents] = useState<{ owned: Agent[]; shared: Agent[]; published: Agent[] } | null>(null)
  const [inbox, setInbox] = useState<ThreadPage | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    getAgents().then(setAgents).catch(setError)
    getInbox().then(setInbox).catch(() => setInbox({ items: [] }))
  }, [])

  const sections: [string, string, Agent[]][] = agents
    ? [
        ["Shared with you", "Colleagues gave you access to these directly.", agents.shared],
        ["Published to your workspace", "Available to everyone in this workspace.", agents.published],
        ["Yours", "Agents you own.", agents.owned],
      ]
    : []

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <section className="flex min-w-0 flex-col gap-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Agents you can use{me?.name ? `, ${me.name.split(" ")[0]}` : ""}</h1>
            <p className="mt-1.5 max-w-[60ch] text-[13.5px] text-muted-foreground">
              What appears here, and what each agent may do as you, is decided by your platform team in LangSmith.
            </p>
          </div>
          {me?.can_build && (
            <Link href="/studio/new" className={buttonClass("primary", "lg")}>
              <Icon name="plus" className="h-4 w-4" />
              New agent
            </Link>
          )}
        </div>
        <ErrorNote error={error} />
        {!agents && !error && <p className="text-[13px] text-muted-foreground">Loading agents…</p>}
        {sections.map(([title, sub, list]) =>
          list.length ? (
            <div key={title} className="flex flex-col gap-3.5">
              <div className="flex items-baseline gap-2">
                <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
                <span className="text-[12px] text-muted-foreground">{list.length}</span>
                <p className="ml-auto hidden text-[12px] text-muted-foreground sm:block">{sub}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {list.map((a) => (
                  <AgentCard key={a.id} agent={a} />
                ))}
              </div>
            </div>
          ) : null,
        )}
        {agents && !agents.owned.length && !agents.shared.length && !agents.published.length && (
          <div className={`${surfaceClass} flex flex-col items-center gap-2 px-6 py-12 text-center`}>
            <p className="text-[14px] font-medium">No agents are available to you yet.</p>
            {me?.can_build ? (
              <Link href="/studio/new" className={buttonClass("primary")}>
                <Icon name="plus" />
                Build one
              </Link>
            ) : (
              <p className="text-[13px] text-muted-foreground">Ask your platform team to share one with you.</p>
            )}
          </div>
        )}
      </section>

      <aside className={`${surfaceClass} flex flex-col overflow-hidden lg:sticky lg:top-20`}>
        <div className="px-4 pb-3 pt-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[14px] font-semibold tracking-tight">Recent conversations</h2>
            {!!inbox?.attention_count && <span className="rounded-full bg-brand-subtle px-2 py-0.5 text-[11px] font-medium text-brand">{inbox.attention_count} need you</span>}
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">Only you can see these. LangSmith scopes threads to the person who started them.</p>
        </div>
        <ul className="flex max-h-[calc(100dvh-14rem)] flex-col divide-y divide-border/60 overflow-y-auto border-t border-border/60">
          {!inbox && <li className="px-4 py-3 text-[12px] text-muted-foreground">Loading…</li>}
          {inbox?.items.length === 0 && <li className="px-4 py-3 text-[12px] text-muted-foreground">No conversations yet.</li>}
          {inbox?.items.map((t) => (
            <li key={t.id}>
              <Link href={`/agents/${t.agent_id ?? t.agent?.id}?thread=${t.id}`} className="flex flex-col gap-0.5 px-4 py-2.5 text-[12.5px] transition-colors hover:bg-accent/60">
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate font-medium">{threadTitle(t)}</span>
                  <StatusDot t={t} />
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {t.agent?.name ?? "agent"} · {ago(t.state_updated_at ?? t.updated_at ?? t.created_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}

export default function Page() {
  return (
    <Shell>
      <UseHome />
    </Shell>
  )
}
