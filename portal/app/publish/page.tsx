"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { BuilderOnly } from "@/components/builder-only"
import { ErrorNote } from "@/components/error-note"
import { Shell, useMe } from "@/components/shell"
import { getAgents } from "@/lib/api"
import type { Agent } from "@/lib/types"

function reach(a: Agent): string {
  const p = a.permissions ?? {}
  const people = (p.shared_users?.read?.length ?? 0) + (p.shared_users?.run?.length ?? 0) + (p.shared_users?.write?.length ?? 0)
  const lvl = { read: "can clone", run: "can run", write: "can edit" }[p.tenant_access_level ?? "read"]
  if (p.visibility === "tenant") return `Everyone in the workspace ${lvl}${people ? ` · +${people} people` : ""}`
  return people ? `${people} ${people === 1 ? "person" : "people"}` : "Only you"
}

/**
 * PUBLISH — who can use what you built. Sharing is owner-only in LangSmith, so this
 * lists the agents you own.
 */
function Publish() {
  const { me } = useMe()
  const [agents, setAgents] = useState<Agent[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    getAgents().then((r) => setAgents(r.owned)).catch(setError)
  }, [])
  if (me && !me.can_build) return <BuilderOnly me={me} what="Publishing" />
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Publish</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">Decide who can use, clone or edit the agents you own. LangSmith enforces it everywhere — here and in Fleet.</p>
      </div>
      <ErrorNote error={error} />
      {!agents && !error && <p className="text-[13px] text-muted-foreground">Loading…</p>}
      {agents?.length === 0 && <p className="rounded-xl border border-dashed p-4 text-[13px] text-muted-foreground">You don&apos;t own any agents yet.</p>}
      <ul className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-2xl bg-card shadow-card ring-1 ring-border/60">
        {agents?.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium">{a.name}</p>
              <p className="truncate text-[12px] text-muted-foreground">{reach(a)}</p>
            </div>
            <Link href={`/publish/${a.id}`} className="rounded-lg border border-border/80 bg-card px-2.5 py-1 text-xs font-medium shadow-card hover:bg-accent">
              Manage access
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Page() {
  return (
    <Shell>
      <Publish />
    </Shell>
  )
}
