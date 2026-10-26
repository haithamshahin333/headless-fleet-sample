import "server-only"

import { FleetError, StreamInterrupted, type FleetClient } from "./core"
import { findInterrupt, getThreadState, messagesOf, type Interrupt, type Message } from "./ops"

/**
 * Re-emit a Fleet run as a small, normalized SSE stream for the browser:
 *
 *   token {text}            token-level delta for the live assistant turn
 *   step  {name}            a tool call just started
 *   state {messages, todos, interrupt, recovered?, thread_status?}
 *   done  {interrupt, recovered?, thread_status?, detail?}
 *   error {detail, hint?, enforced_by?}
 *
 * The browser never has to know that `values` resends whole state, that `__interrupt__`
 * is a key rather than an event, or that heartbeats exist. A dropped upstream stream is
 * NOT a failure — the run continues server-side — so on a drop we re-read thread state
 * and emit it as the authoritative final frame, flagged `recovered`.
 *
 * While upstream is quiet (a long tool call), a `: keepalive` comment goes out every
 * KEEPALIVE_MS. Fleet's own heartbeats are dropped by the parser in core.ts, and proxies
 * (ingress-nginx defaults to 60 s) close a connection that sends nothing.
 */

type Obj = Record<string, unknown>
const TOOLISH = new Set(["tool", "toolmessage", "toolmessagechunk", "function"])

/** One `messages-tuple` frame `[chunk, metadata]` → (text delta, tool start). */
function tokenOf(data: unknown): { text: string | null; tool: string | null } {
  const chunk = (Array.isArray(data) ? data[0] : data) as Obj | undefined
  if (!chunk || typeof chunk !== "object") return { text: null, tool: null }
  const kind = String(chunk.type ?? chunk.role ?? "").toLowerCase()
  // Tool chunks are raw tool RESULTS (file dumps, JSON) — never render them as prose.
  if (TOOLISH.has(kind)) return { text: null, tool: null }
  let text: string | null = null
  if (typeof chunk.content === "string" && chunk.content) text = chunk.content
  else if (Array.isArray(chunk.content)) {
    text = (chunk.content as Obj[]).filter((b) => b?.type === "text").map((b) => String(b.text ?? "")).join("") || null
  }
  // Only the first chunk of a tool call carries `name`.
  const first = ((chunk.tool_call_chunks as Obj[] | undefined) ?? []).find((b) => b?.name)
  return { text, tool: first ? String(first.name) : null }
}

const KEEPALIVE_MS = 15_000
const enc = new TextEncoder()
const KEEPALIVE = enc.encode(": keepalive\n\n")
const frame = (event: string, payload: unknown) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)

export function sseResponse(
  fleet: FleetClient,
  threadId: string,
  run: (signal: AbortSignal) => AsyncGenerator<{ event: string; data: unknown }>,
  explain: (err: unknown) => Promise<Obj>,
): Response {
  const abort = new AbortController()
  let keepalive: ReturnType<typeof setInterval> | undefined
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let messages: Message[] = []
      let todos: Obj[] = []
      let interrupt: Interrupt | null = null
      const send = (e: string, p: unknown) => {
        try {
          controller.enqueue(frame(e, p))
        } catch {
          /* client went away */
        }
      }
      keepalive = setInterval(() => {
        try {
          controller.enqueue(KEEPALIVE)
        } catch {
          clearInterval(keepalive)
        }
      }, KEEPALIVE_MS)
      try {
        for await (const f of run(abort.signal)) {
          if (f.event.startsWith("messages")) {
            const { text, tool } = tokenOf(f.data)
            if (text) send("token", { text })
            if (tool) send("step", { name: tool })
            continue
          }
          const data = f.data as Obj
          if (!data || typeof data !== "object" || Array.isArray(data)) continue
          const hasMessages = Array.isArray(data.messages)
          if (hasMessages) messages = messagesOf(data)
          if (Array.isArray(data.todos)) todos = data.todos as Obj[]
          // A state frame without __interrupt__ means nothing is pending any more, so
          // this OVERWRITES — latching the first one makes an approval loop endless.
          if (hasMessages || "__interrupt__" in data) interrupt = findInterrupt(data)
          send("state", { messages, todos, interrupt })
        }
        send("done", { interrupt })
      } catch (err) {
        if (err instanceof StreamInterrupted) {
          try {
            const s = await getThreadState(fleet, threadId)
            send("state", { messages: s.messages, todos: s.todos, interrupt: s.interrupt, recovered: true, thread_status: s.status })
            send("done", {
              interrupt: s.interrupt,
              recovered: true,
              thread_status: s.status,
              detail: "The stream from Fleet closed mid-run; the run continued and this is the thread's current state.",
            })
          } catch (inner) {
            send("error", { detail: `stream dropped and recovery failed: ${String(inner)}` })
          }
        } else if (err instanceof FleetError) {
          send("error", await explain(err))
        } else if (!abort.signal.aborted) {
          send("error", { detail: err instanceof Error ? err.message : String(err) })
        }
      } finally {
        clearInterval(keepalive)
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      clearInterval(keepalive)
      abort.abort()
    },
  })
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  })
}
