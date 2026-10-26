"use client"

import { useState } from "react"

import { humanizeTool } from "@/lib/humanize"
import type { Message } from "@/lib/types"
import { MarkdownProse } from "./markdown-prose"

/**
 * Tool activity, humanized and collapsed.
 *
 * The first version of this portal rendered tool *messages* — whose content is a raw
 * result: base64 Outlook ids, file dumps, JSON blobs. It looked like debugging output.
 * Tool messages are now dropped entirely and each AI turn's `tool_calls` become a
 * compact step list, collapsed once the answer arrives. Same approach as
 * langchain-samples/liam-headless-fleet-demo.
 */
function StepList({ steps, live }: { steps: string[]; live?: boolean }) {
  const [open, setOpen] = useState(false)
  if (steps.length === 0) return null

  if (live) {
    const current = steps[steps.length - 1]
    const done = steps.length - 1
    return (
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-2 text-[12.5px] font-medium">
          <span
            className="h-3 w-3 flex-none animate-spin rounded-full border-2 border-brand border-t-transparent"
            aria-hidden
          />
          {current}
        </span>
        {done > 0 && (
          <span className="pl-5 text-[11px] text-muted-foreground">
            {done} step{done === 1 ? "" : "s"} done
          </span>
        )}
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-brand-border"
      >
        <span style={{ color: "oklch(0.52 0.13 155)" }}>✓</span>
        {steps.length} step{steps.length === 1 ? "" : "s"}
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>›</span>
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-1 border-l pl-3">
          {steps.map((s, i) => (
            <span key={`${s}-${i}`} className="text-[11px] text-muted-foreground">
              <span style={{ color: "oklch(0.52 0.13 155)" }}>✓</span> {s}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function Transcript({
  messages,
  liveText,
  liveSteps,
  streaming,
}: {
  messages: Message[]
  liveText?: string
  liveSteps?: string[]
  streaming?: boolean
}) {
  // Tool messages carry results, not conversation. Drop them; their activity is
  // reconstructed from the requesting AI message's tool_calls.
  const visible = messages.filter((m) => m.type !== "system" && m.type !== "tool")

  return (
    <div className="flex flex-col gap-3.5">
      {visible.map((m, i) => {
        const mine = m.type === "human"
        const steps = (m.tool_calls ?? []).map((t) => humanizeTool(t.name, t.arg))
        if (!m.text && steps.length === 0) return null

        return (
          <div key={i} className="animate-message-in flex max-w-[74ch] flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {mine ? "You" : "Agent"}
            </span>
            {steps.length > 0 && <StepList steps={steps} />}
            {m.text ? (
              mine ? (
                <div className="rounded-lg rounded-tl-sm bg-secondary px-3 py-2 text-[13px] text-secondary-foreground">
                  {m.text}
                </div>
              ) : (
                <MarkdownProse>{m.text}</MarkdownProse>
              )
            ) : null}
          </div>
        )
      })}

      {/* The in-flight turn: tokens as they arrive, plus whatever tool is running. */}
      {streaming && (liveText || (liveSteps?.length ?? 0) > 0) && (
        <div className="animate-message-in flex max-w-[74ch] flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Agent
          </span>
          {!liveText && liveSteps && liveSteps.length > 0 && <StepList steps={liveSteps} live />}
          {liveText && <MarkdownProse>{liveText}</MarkdownProse>}
        </div>
      )}
    </div>
  )
}
