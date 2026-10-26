"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { ApiError, deleteSkill, getSkillUsage, removeSkill } from "@/lib/api"
import type { SkillUsage, WorkspaceSkill } from "@/lib/types"
import { ErrorNote } from "../error-note"
import { Button } from "../ui"

type Result = { name: string; ok: boolean; why?: string }

/**
 * Delete a workspace skill, then unlink it from every agent you can edit.
 *
 * Agents link a skill by NAME. After a delete, anyone in the workspace could create a new
 * skill with that name, and every agent still linking it would load that text. Unlinking
 * closes the gap for the agents you can edit; the others are named so you can tell their
 * owners. Delete comes FIRST: if LangSmith refuses it (not the creator), nothing has changed.
 */
export function DeleteSkillDialog({ skill, onDone, onClose }: { skill: WorkspaceSkill; onDone: () => void; onClose: () => void }) {
  const [usage, setUsage] = useState<SkillUsage | null>(null)
  const [usageError, setUsageError] = useState<unknown>(null)
  const [phase, setPhase] = useState<"confirm" | "working" | "done">("confirm")
  const [error, setError] = useState<unknown>(null)
  const [results, setResults] = useState<Result[]>([])

  useEffect(() => {
    getSkillUsage(skill.id).then(setUsage).catch(setUsageError)
  }, [skill.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "working") (phase === "done" ? onDone : onClose)()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, onDone, phase])

  const editable = usage?.agents.filter((a) => a.can_edit) ?? []
  const others = usage?.agents.filter((a) => !a.can_edit) ?? []

  async function run() {
    setPhase("working")
    setError(null)
    try {
      await deleteSkill(skill.id)
    } catch (e) {
      setError(e)
      setPhase("confirm")
      return
    }
    // One at a time: each unlink is a commit on that agent.
    const out: Result[] = []
    for (const a of editable) {
      try {
        await removeSkill(a.id, skill.id)
        out.push({ name: a.name, ok: true })
      } catch (e) {
        out.push({ name: a.name, ok: false, why: e instanceof ApiError ? (e.hint ?? e.message) : String(e) })
      }
      setResults([...out])
    }
    setPhase("done")
  }

  const close = phase === "done" ? onDone : onClose
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4 backdrop-blur-sm" onClick={phase === "working" ? undefined : close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Delete ${skill.name ?? skill.id}`}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[min(34rem,95vw)] flex-col gap-4 overflow-y-auto rounded-2xl bg-card p-5 text-[13px] shadow-pop ring-1 ring-border/60"
      >
        <h2 className="text-[15px] font-semibold tracking-tight">
          {phase === "done" ? "Deleted" : "Delete"} <span className="font-mono">{skill.id}</span>
          {phase === "done" ? "" : "?"}
        </h2>

        {phase !== "done" && (
          <>
            {!usage && !usageError && <p className="text-muted-foreground">Checking which agents use it…</p>}
            {usageError != null && <p className="text-muted-foreground">Couldn&apos;t check which agents use it. Agents that link it will keep a broken link.</p>}
            {usage && (
              <div className="flex flex-col gap-3">
                {usage.agents.length === 0 && <p>None of the {usage.checked} agents you can see use it.</p>}
                {editable.length > 0 && (
                  <div>
                    <p className="font-medium">Will be unlinked ({editable.length})</p>
                    <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                      {editable.map((a) => (
                        <li key={a.id}>{a.name}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {others.length > 0 && (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12.5px]">
                    <p className="font-medium">You can&apos;t edit these ({others.length})</p>
                    <ul className="mt-1 list-disc pl-5">
                      {others.map((a) => (
                        <li key={a.id}>
                          {a.name}
                          {a.owner ? <span className="text-muted-foreground"> (owner: {a.owner})</span> : null}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-muted-foreground">
                      Their owners must unlink it. Until they do, if someone creates a skill named <span className="font-mono">{skill.id}</span>, these agents will use it.
                    </p>
                  </div>
                )}
                <p className="text-[12px] text-muted-foreground">
                  Other agents in the workspace may use it too.
                  {usage.checked < usage.total && ` Checked the first ${usage.checked} of the ${usage.total} agents you can see.`}
                </p>
              </div>
            )}
            <ErrorNote error={error} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={phase === "working"}>
                Cancel
              </Button>
              <Button variant="danger" onClick={run} disabled={phase === "working" || (!usage && !usageError)}>
                {phase === "working" ? "Deleting…" : editable.length ? `Delete and unlink from ${editable.length}` : "Delete"}
              </Button>
            </div>
          </>
        )}

        {phase === "done" && (
          <>
            <p>The skill is gone from the workspace.</p>
            {results.length > 0 && (
              <ul className="flex flex-col gap-1">
                {results.map((r) => (
                  <li key={r.name} className={r.ok ? "text-muted-foreground" : "text-destructive"}>
                    {r.ok ? `Unlinked from ${r.name}` : `Couldn't unlink from ${r.name}: ${r.why}`}
                  </li>
                ))}
              </ul>
            )}
            {results.some((r) => !r.ok) && (
              <p className="text-[12px] text-muted-foreground">
                Those agents show the skill as missing in <Link href="/studio" className="text-brand underline">Build</Link>, with Unlink.
              </p>
            )}
            <div className="flex justify-end">
              <Button variant="primary" onClick={onDone}>
                Done
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
