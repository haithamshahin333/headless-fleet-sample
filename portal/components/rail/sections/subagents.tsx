"use client"

import { useState } from "react"

import { deleteSubagent, putSubagent } from "@/lib/api"
import type { Agent } from "@/lib/types"
import { Button } from "../../ui"
import { inputClass, RailEditor } from "../RailEditor"

/**
 * Subagents — delegation targets, each with its own prompt.
 *
 * The API semantics here are unusual enough to shape the UI. `subagents` MERGES by name,
 * so this section adds/updates one at a time rather than submitting a list: sending a
 * shorter list does not delete anything, and `subagents: []` is a no-op. Deletion goes
 * through a separate call that removes the subagent's files. So there is no combined
 * "save the list" — add, edit and delete are each their own action, which is also what
 * makes the section honest about what it just did.
 *
 * Per-subagent tools are intentionally left out of this pass: it would mean nesting the
 * whole Tools editor, and a subagent with no tools still demonstrates delegation.
 */
export function SubagentsSection({
  agent,
  onSaved,
}: {
  agent: Agent
  onSaved: (a: Agent) => void
}) {
  const existing = agent.subagents ?? []
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [prompt, setPrompt] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const valid = /^[a-zA-Z0-9._-]+$/.test(name)

  function reset() {
    setName("")
    setDescription("")
    setPrompt("")
  }

  async function remove(target: string) {
    setBusy(target)
    setError(null)
    try {
      onSaved(await deleteSubagent(agent.id, target))
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed")
    } finally {
      setBusy(null)
    }
  }

  return (
    <RailEditor
      label="Subagents"
      summary={String(existing.length)}
      dirty={Boolean(name.trim())}
      disabled={!valid}
      saveLabel="Add subagent"
      onCancel={reset}
      onSave={async () => {
        onSaved(
          await putSubagent(agent.id, {
            name: name.trim(),
            description: description.trim(),
            system_prompt: prompt.trim(),
          }),
        )
        reset()
      }}
    >
      {existing.length > 0 && (
        <div className="flex flex-col gap-1">
          {existing.map((s) => (
            <div
              key={s.name}
              className="flex items-start justify-between gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5 ring-1 ring-border/50"
            >
              <span className="min-w-0">
                <span className="block truncate text-[11.5px] font-medium">{s.name}</span>
                {s.description && (
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {s.description}
                  </span>
                )}
              </span>
              <Button
                size="sm"
                variant="danger"
                className="h-6 flex-none border-transparent px-1.5 text-[10px]"
                disabled={busy === s.name}
                onClick={() => remove(s.name)}
              >
                {busy === s.name ? "…" : "remove"}
              </Button>
            </div>
          ))}
        </div>
      )}

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name, e.g. researcher"
        maxLength={80}
        className={inputClass}
      />
      {name && !valid && (
        <p className="text-[10px] text-destructive">
          Letters, digits, dot, dash and underscore only — the name becomes a directory.
        </p>
      )}
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What is it for?"
        maxLength={600}
        className={inputClass}
      />
      <textarea
        rows={4}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Its instructions (subagents/<name>/AGENTS.md)"
        maxLength={20000}
        className={`${inputClass} resize-y font-mono`}
      />
      {error && <p className="text-[10.5px] text-destructive">{error}</p>}
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Adding is an upsert by name; removing deletes the subagent&rsquo;s files. Tools per
        subagent aren&rsquo;t editable here yet.
      </p>
    </RailEditor>
  )
}
