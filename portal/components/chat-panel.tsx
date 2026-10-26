"use client"

import { useEffect, useRef, useState } from "react"

import type { Agent } from "@/lib/types"
import { useChat } from "@/lib/use-chat"
import { ApprovalGate } from "./approval-gate"
import { AuthGate } from "./auth-gate"
import { ErrorNote } from "./error-note"
import { TodoPanel } from "./todo-panel"
import { Transcript } from "./transcript"
import { Button } from "./ui"

/**
 * One conversation surface. Use mounts it full-height with history; Build mounts it as
 * the test pane on `test_run` threads (kept out of history and analytics).
 */
export function ChatPanel({
  agent,
  threadId,
  testRun,
  blocked,
  emptyHint,
  onThreadCreated,
  onSettled,
}: {
  agent: Agent
  threadId: string | null
  testRun?: boolean
  /** e.g. a required connection is missing — the composer explains instead of sending. */
  blocked?: string | null
  emptyHint?: React.ReactNode
  onThreadCreated?: (id: string) => void
  onSettled?: () => void
}) {
  const chat = useChat({ agentId: agent.id, threadId, testRun, onThreadCreated, onSettled })
  const [text, setText] = useState("")
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [chat.messages, chat.liveText, chat.liveSteps, chat.interrupt])

  const pending = chat.interrupt
  const canSend = !chat.busy && !pending && !blocked && text.trim().length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 py-3"
      >
        {chat.loading && <p className="text-[12px] text-muted-foreground">Loading conversation…</p>}
        {!chat.loading && chat.messages.length === 0 && !chat.busy && (emptyHint ?? null)}
        {chat.todos.length > 0 && <TodoPanel todos={chat.todos} />}
        <Transcript messages={chat.messages} liveText={chat.liveText} liveSteps={chat.liveSteps} streaming={chat.busy} />
        {chat.recovered && (
          <p className="max-w-[62ch] rounded-xl border border-dashed px-3 py-2 text-[11.5px] text-muted-foreground">
            The live stream from Fleet closed mid-run; the run kept going server-side and this is the thread&apos;s current
            state ({chat.recovered}). Reload the conversation to pick up anything newer.
          </p>
        )}
        {pending?.kind === "approval" && <ApprovalGate interrupt={pending} busy={chat.busy} onDecide={chat.decide} />}
        {(pending?.kind === "auth_required" || pending?.kind === "auth_unavailable") && (
          <AuthGate agent={agent} interrupt={pending} busy={chat.busy} onResolve={chat.resolveAuth} />
        )}
        {pending?.kind === "other" && (
          <div className="max-w-[62ch] rounded-xl p-3 text-[12.5px] ring-1 ring-border/60 text-muted-foreground">
            The agent paused with a prompt this portal doesn&apos;t render yet. Open the thread in LangSmith to answer it.
          </div>
        )}
        {chat.busy && !chat.liveText && chat.liveSteps.length === 0 && (
          <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-hidden />
            Thinking…
          </span>
        )}
        <ErrorNote error={chat.error} className="max-w-[62ch]" />
      </div>

      <form
        className="flex items-center gap-2 border-t pt-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!canSend) return
          const t = text.trim()
          setText("")
          stick.current = true
          void chat.send(t)
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!!pending || !!blocked}
          placeholder={blocked ?? (pending ? "Answer the prompt above to continue…" : `Message ${agent.name}…`)}
          aria-label="Message"
          className="h-10 flex-1 rounded-xl border border-input bg-background px-4 text-[13.5px] shadow-card outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/70 focus:border-brand focus:ring-3 focus:ring-ring/20 disabled:opacity-60"
        />
        <Button type="submit" variant="primary" size="lg" disabled={!canSend}>
          Send
        </Button>
      </form>
    </div>
  )
}
