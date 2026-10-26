"use client"

import { useState } from "react"

import type { Interrupt } from "@/lib/types"
import { Button, Mono } from "./ui"

const LABELS: Record<string, string> = { approve: "Approve", reject: "Deny", respond: "Reply instead" }

/**
 * The real guardrail. Instructions land as AGENTS.md, which the harness subordinates to
 * the user's turn — they cannot enforce policy. A tool-approval interrupt can. Buttons
 * come from the interrupt's own `allowed_decisions` (`edit` needs a schema-driven form,
 * so it is out of scope here).
 */
export function ApprovalGate({ interrupt, busy, onDecide }: { interrupt: Interrupt; busy: boolean; onDecide: (decision: string, message: string | null) => void }) {
  const request = interrupt.action_requests?.[0]
  const allowed = (interrupt.review_configs?.[0]?.allowed_decisions ?? ["approve", "reject"]).filter((d) => d !== "edit")
  const [replying, setReplying] = useState(false)
  const [reply, setReply] = useState("")

  return (
    <div className="animate-gate-in max-w-[62ch] rounded-2xl bg-brand-subtle p-4 ring-1 ring-brand-border">
      <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-brand">⏸ Needs your approval</p>
      <p className="mb-1 text-[13px]">
        This agent wants to run <Mono className="font-medium">{request?.name}</Mono>.
      </p>
      {request?.args && Object.keys(request.args).length > 0 && (
        <pre className="mb-3 overflow-x-auto rounded-lg bg-background/70 p-2.5 ring-1 ring-border/50 font-mono text-[11.5px] text-muted-foreground">{JSON.stringify(request.args, null, 2)}</pre>
      )}
      {replying ? (
        <div className="flex flex-col gap-2">
          <textarea
            autoFocus
            rows={2}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="What should the agent do instead?"
            className="resize-none rounded-lg border border-input bg-background px-3 py-2 text-[13px] outline-none focus:border-brand focus:ring-3 focus:ring-ring/20"
          />
          <div className="flex gap-2">
            <Button variant="primary" size="sm" disabled={busy || !reply.trim()} onClick={() => onDecide(allowed.includes("respond") ? "respond" : "reject", reply.trim())}>
              Send
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setReplying(false)} disabled={busy}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {allowed.map((d) =>
            d === "respond" ? (
              <Button key={d} size="sm" disabled={busy} onClick={() => setReplying(true)}>
                {LABELS[d]}
              </Button>
            ) : (
              <Button key={d} variant={d === "approve" ? "primary" : "default"} size="sm" disabled={busy} onClick={() => onDecide(d, null)}>
                {LABELS[d] ?? d}
              </Button>
            ),
          )}
        </div>
      )}
      <p className="mt-2.5 text-[11px] text-muted-foreground">
        Answered with <Mono className="text-[11px]">command.resume</Mono> on a new streamed run.
      </p>
    </div>
  )
}
