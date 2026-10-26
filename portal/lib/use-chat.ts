"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { ApiError, createThread, getThreadState, resumeApproval, resumeAuth, sendMessage, type StreamHandlers } from "./api"
import { humanizeTool } from "./humanize"
import type { Interrupt, Message, Todo } from "./types"

/**
 * One conversation with one agent: load a thread, stream turns, answer interrupts.
 * Shared by the Use chat and the Build test pane (which uses `test_run` threads so its
 * conversations stay out of history and analytics).
 */
export function useChat(opts: { agentId: string; threadId: string | null; testRun?: boolean; onThreadCreated?: (id: string) => void; onSettled?: () => void }) {
  const { agentId, testRun, onThreadCreated, onSettled } = opts
  const [threadId, setThreadId] = useState<string | null>(opts.threadId)
  const [messages, setMessages] = useState<Message[]>([])
  const [todos, setTodos] = useState<Todo[]>([])
  const [interrupt, setInterrupt] = useState<Interrupt | null>(null)
  const [liveText, setLiveText] = useState("")
  const [liveSteps, setLiveSteps] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | Error | null>(null)
  const [recovered, setRecovered] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  // A thread created by the first send must not trigger the reload effect below — that
  // would abort the very stream that is filling it.
  const createdHere = useRef<string | null>(null)

  // Follow the caller's thread selection (URL ?thread=).
  useEffect(() => {
    setThreadId(opts.threadId)
  }, [opts.threadId])

  useEffect(() => {
    if (threadId && threadId === createdHere.current) return
    abort.current?.abort()
    setMessages([])
    setTodos([])
    setInterrupt(null)
    setError(null)
    setRecovered(null)
    setLiveText("")
    setLiveSteps([])
    if (!threadId) return
    let cancelled = false
    setLoading(true)
    getThreadState(threadId)
      .then((s) => {
        if (cancelled) return
        setMessages(s.messages)
        setTodos(s.todos)
        setInterrupt(s.interrupt)
      })
      .catch((e) => !cancelled && setError(e))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [threadId])

  const handlers: StreamHandlers = {
    onState: (s) => {
      setMessages(s.messages)
      setTodos(s.todos)
      setInterrupt(s.interrupt)
      setLiveText("")
      setLiveSteps([])
      if (s.recovered) setRecovered(s.thread_status ?? "unknown")
    },
    onToken: (t) => setLiveText((x) => x + t),
    onStep: (name) => setLiveSteps((xs) => [...xs, humanizeTool(name, null)]),
  }

  const run = useCallback(
    async (fn: (tid: string, signal: AbortSignal) => Promise<unknown>) => {
      setBusy(true)
      setError(null)
      setRecovered(null)
      const ctl = new AbortController()
      abort.current = ctl
      try {
        let tid = threadId
        if (!tid) {
          tid = (await createThread(agentId, !!testRun)).thread_id
          createdHere.current = tid
          setThreadId(tid)
          onThreadCreated?.(tid)
        }
        await fn(tid, ctl.signal)
      } catch (e) {
        if (!ctl.signal.aborted) setError(e instanceof Error ? e : new Error(String(e)))
      } finally {
        setBusy(false)
        setLiveText("")
        setLiveSteps([])
        onSettled?.()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [threadId, agentId, testRun, onThreadCreated, onSettled],
  )

  const send = useCallback(
    (text: string) =>
      run(async (tid, signal) => {
        setMessages((m) => [...m, { type: "human", text, tool_calls: [] }])
        await sendMessage(tid, agentId, text, handlers, signal)
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, agentId],
  )

  const decide = useCallback(
    (decision: string, message: string | null) =>
      run(async (tid, signal) => {
        setInterrupt(null)
        await resumeApproval(tid, agentId, decision, message, handlers, signal)
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, agentId],
  )

  const resolveAuth = useCallback(
    (action: "continue" | "skip") =>
      run(async (tid, signal) => {
        setInterrupt(null)
        await resumeAuth(tid, agentId, action, handlers, signal)
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, agentId],
  )

  const reset = useCallback(() => {
    abort.current?.abort()
    setThreadId(null)
  }, [])

  return { threadId, messages, todos, interrupt, liveText, liveSteps, busy, loading, error, recovered, send, decide, resolveAuth, reset }
}
