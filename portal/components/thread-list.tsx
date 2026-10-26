"use client"

import clsx from "clsx"
import Link from "next/link"

import type { ThreadSummary } from "@/lib/types"
import { Icon } from "./ui"

export function ago(iso?: string): string {
  if (!iso) return ""
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function threadTitle(t: ThreadSummary): string {
  const last = typeof t.last_message === "string" ? t.last_message : t.last_message?.content
  return (t.title || last || "New conversation").replace(/\s+/g, " ").slice(0, 80)
}

export function StatusDot({ t }: { t: ThreadSummary }) {
  const s = t.has_interrupts || t.status === "interrupted" ? "needs you" : t.status === "busy" ? "working" : t.status === "error" ? "error" : null
  if (!s) return null
  return (
    <span
      className={clsx(
        "flex-none rounded-full px-1.5 py-px text-[10px] font-medium",
        s === "needs you" && "bg-brand-subtle text-brand",
        s === "working" && "bg-secondary text-muted-foreground",
        s === "error" && "bg-destructive/10 text-destructive",
      )}
    >
      {s}
    </span>
  )
}

/** YOUR conversations with one agent. Fleet scopes the list to the caller. */
export function ThreadList({
  agentId,
  threads,
  selected,
  hasMore,
  onMore,
}: {
  agentId: string
  threads: ThreadSummary[]
  selected: string | null
  hasMore: boolean
  onMore: () => void
}) {
  return (
    <nav aria-label="Your conversations" className="flex min-h-0 flex-col gap-1">
      <Link
        href={`/agents/${agentId}`}
        className={clsx(
          "mb-2 flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium shadow-card ring-1 transition-colors",
          selected ? "bg-card ring-border/60 hover:bg-accent" : "bg-brand-subtle text-brand ring-brand-border",
        )}
      >
        <Icon name="plus" />
        New conversation
      </Link>
      <p className="px-2 pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Your history</p>
      {threads.length === 0 && <p className="px-2 text-[11.5px] text-muted-foreground">No conversations yet.</p>}
      {threads.map((t) => (
        <Link
          key={t.id}
          href={`/agents/${agentId}?thread=${t.id}`}
          className={clsx(
            "flex flex-col gap-0.5 rounded-lg px-2.5 py-2 text-[12.5px] transition-colors hover:bg-accent/70",
            selected === t.id && "bg-card font-medium shadow-card ring-1 ring-border/60",
          )}
        >
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate">{threadTitle(t)}</span>
            <StatusDot t={t} />
          </span>
          <span className="text-[10.5px] text-muted-foreground">{ago(t.state_updated_at ?? t.updated_at ?? t.created_at)}</span>
        </Link>
      ))}
      {hasMore && (
        <button onClick={onMore} className="px-2 py-1 text-left text-[11.5px] text-brand hover:underline">
          Load more
        </button>
      )}
    </nav>
  )
}
