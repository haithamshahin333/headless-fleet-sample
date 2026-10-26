"use client"

import { useEffect, useState } from "react"

import { putInstructions } from "@/lib/api"
import type { Agent } from "@/lib/types"
import { inputClass, RailEditor } from "../RailEditor"

/**
 * AGENTS.md. Worth knowing what this is and is not: the value lands as `AGENTS.md` and is
 * injected at runtime inside an `<agent_memory>` block that the harness explicitly
 * subordinates to the user's turn. It is guidance, not a guardrail — which is why the
 * hint below points at tool approval for anything that must actually be enforced.
 */
export function InstructionsSection({
  agent,
  onSaved,
}: {
  agent: Agent
  onSaved: (a: Agent) => void
}) {
  const initial = agent.system_prompt ?? ""
  const [draft, setDraft] = useState(initial)
  useEffect(() => setDraft(initial), [initial])

  return (
    <RailEditor
      label="Instructions"
      summary={initial ? `${initial.length} chars` : "not set"}
      dirty={draft !== initial}
      onCancel={() => setDraft(initial)}
      onSave={async () => onSaved(await putInstructions(agent.id, draft))}
    >
      <textarea
        rows={10}
        maxLength={20000}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="What should this agent do, and how?"
        className={`${inputClass} resize-y font-mono leading-relaxed`}
      />
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Stored as <code className="font-mono">AGENTS.md</code>. Injected as agent memory,
        which the harness treats as reference material subordinate to the user&rsquo;s
        message — so use tool approval for anything that must be enforced.
      </p>
    </RailEditor>
  )
}
