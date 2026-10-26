"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { BuilderOnly } from "@/components/builder-only"
import { AccessBadge, ErrorNote } from "@/components/error-note"
import { Shell, useMe } from "@/components/shell"
import { AgentAvatar, buttonClass, Icon, surfaceClass } from "@/components/ui"
import { getAgents } from "@/lib/api"
import type { Agent } from "@/lib/types"

/** BUILD — agents you can edit (Fleet `access_level=write`), and a way to make new ones. */
function Studio() {
  const { me } = useMe()
  const [agents, setAgents] = useState<Agent[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    getAgents()
      .then((r) => setAgents([...r.owned, ...r.shared, ...r.published].filter((a) => a.access_level === "write")))
      .catch(setError)
  }, [])

  if (me && !me.can_build) return <BuilderOnly me={me} what="Building agents" />

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Build</h1>
          <p className="mt-1.5 text-[13.5px] text-muted-foreground">Agents you can edit. Building happens here, sharing happens in Publish.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/studio/skills" className={buttonClass("default", "lg")}>
            <Icon name="sparkle" className="h-4 w-4" />
            Skills
          </Link>
          <Link href="/studio/new" className={buttonClass("primary", "lg")}>
            <Icon name="plus" className="h-4 w-4" />
            New agent
          </Link>
        </div>
      </div>
      <ErrorNote error={error} />
      {!agents && !error && <p className="text-[13px] text-muted-foreground">Loading…</p>}
      {agents?.length === 0 && (
        <div className={`${surfaceClass} flex flex-col items-center gap-3 px-6 py-12 text-center`}>
          <p className="text-[14px] font-medium">Nothing to edit yet.</p>
          <Link href="/studio/new" className={buttonClass("primary")}>
            <Icon name="plus" />
            Start with a new agent
          </Link>
        </div>
      )}
      {!!agents?.length && (
        <ul className={`${surfaceClass} flex flex-col divide-y divide-border/60 overflow-hidden`}>
          {agents.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5 transition-colors hover:bg-accent/40">
              <AgentAvatar id={a.id} name={a.name} />
              <div className="min-w-0 flex-1">
                <Link href={`/studio/${a.id}`} className="block truncate text-[14px] font-semibold tracking-tight hover:text-brand">
                  {a.name}
                </Link>
                <p className="truncate text-[12px] text-muted-foreground">
                  {a.tools?.tools?.length ?? 0} tools · {a.permissions?.identity === "shared" ? "shared connections" : "acts as each user"}
                  {a.backend?.type === "sandbox" ? " · computer" : ""} ·{" "}
                  {a.permissions?.visibility === "tenant" ? `published (${a.permissions.tenant_access_level})` : "private"}
                </p>
              </div>
              <AccessBadge level={a.access_level} owner={a.is_owner} />
              <div className="flex items-center gap-1.5">
                <Link href={`/studio/${a.id}`} className={buttonClass("default", "sm")}>
                  Edit
                </Link>
                {a.is_owner && (
                  <Link href={`/publish/${a.id}`} className={buttonClass("ghost", "sm")}>
                    Publish
                  </Link>
                )}
                <Link href={`/agents/${a.id}`} className={buttonClass("ghost", "sm")}>
                  Use
                  <Icon name="chevron" className="h-3 w-3" />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function Page() {
  return (
    <Shell>
      <Studio />
    </Shell>
  )
}
