"use client"

import { useEffect, useState } from "react"

import { addSkill, removeSkill } from "@/lib/api"
import type { Agent, Context } from "@/lib/types"
import { ErrorNote } from "../../error-note"
import { Button } from "../../ui"
import { CheckRow, RailEditor } from "../RailEditor"

/** Which workspace skills an agent links, read from the `files` map. */
export function attachedSkills(agent: Agent): string[] {
  return Object.entries(agent.files ?? {})
    .filter(([, e]) => e?.type === "skill")
    .map(([path, e]) => e.repo_handle ?? path.replace(/^skills\//, ""))
}

/**
 * Skills stored INSIDE the agent (Fleet's "private" skills): plain files at
 * `skills/<name>/SKILL.md`. The portal shows them but never creates or edits them.
 */
export function privateSkills(agent: Agent): string[] {
  return Object.entries(agent.files ?? {})
    .filter(([path, e]) => e?.type !== "skill" && /^skills\/[^/]+\/SKILL\.md$/.test(path))
    .map(([path]) => path.split("/")[1])
}

/**
 * Linked workspace skills.
 *
 * Unlike Tools, this is not a wholesale replace: `files` is an upsert by path, so each
 * skill is attached and detached individually. That also means saving here cannot disturb
 * AGENTS.md or the tool set. Detaching is explicit (`remove_file_paths`) — omitting a key
 * does nothing.
 *
 * A linked skill that is no longer in the workspace is shown as missing: Fleet keeps the
 * link after a delete, and the agent's read of it fails. That is only decidable against the
 * FULL skill list, so it is not shown when LangSmith refused the list.
 *
 * Note: `files` only appears when the agent was fetched with `?include=files`. If it is
 * missing, this section says so rather than claiming zero skills.
 */
export function SkillsSection({
  agent,
  ctx,
  onSaved,
}: {
  agent: Agent
  ctx: Context | null
  onSaved: (a: Agent) => void
}) {
  const attached = attachedSkills(agent)
  const attachedKey = attached.join("|")
  const [pending, setPending] = useState<string[]>(attached)
  const [unlinking, setUnlinking] = useState<string | null>(null)
  const [unlinkError, setUnlinkError] = useState<unknown>(null)
  // The agent changes underneath this section (catalog adds, new skills): follow it.
  useEffect(() => setPending(attachedKey ? attachedKey.split("|") : []), [attachedKey])
  const unknown = agent.files === undefined

  const known = new Set((ctx?.skills ?? []).map((s) => s.id))
  const missing = ctx && !ctx.blocked?.skills ? attached.filter((h) => !known.has(h)) : []
  const inside = privateSkills(agent)
  const linkable = attached.filter((h) => !missing.includes(h))

  const toAdd = pending.filter((h) => !attached.includes(h))
  const toRemove = linkable.filter((h) => !pending.includes(h))
  const dirty = toAdd.length > 0 || toRemove.length > 0

  const linked = attached.length - missing.length
  const summary = unknown
    ? "—"
    : [linked || (!inside.length && !missing.length) ? String(linked) : "", inside.length ? `${inside.length} private` : "", missing.length ? `${missing.length} missing` : ""]
        .filter(Boolean)
        .join(" · ")

  return (
    <RailEditor
      label="Skills"
      summary={summary}
      dirty={dirty}
      onCancel={() => setPending(attached)}
      onSave={async () => {
        // Sequential, not parallel: each is a commit on the same file tree, and
        // concurrent commits invite a needless conflict.
        let latest: Agent = agent
        for (const h of toAdd) latest = await addSkill(agent.id, h)
        for (const h of toRemove) latest = await removeSkill(agent.id, h)
        onSaved(latest)
      }}
    >
      {unknown && (
        <p className="text-[10.5px] text-muted-foreground">
          Skill links are only visible when the agent is loaded with{" "}
          <code className="font-mono">?include=files</code>.
        </p>
      )}
      {missing.map((h) => (
        <div key={h} className="flex items-start gap-2 rounded-lg bg-destructive/5 px-1.5 py-1.5">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-[11.5px]">{h}</span>
            <span className="block text-[10px] text-destructive">Missing: deleted from the workspace. The agent can&apos;t load it.</span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={unlinking === h}
            onClick={async () => {
              setUnlinking(h)
              setUnlinkError(null)
              try {
                onSaved(await removeSkill(agent.id, h))
              } catch (e) {
                setUnlinkError(e)
              } finally {
                setUnlinking(null)
              }
            }}
          >
            {unlinking === h ? "Unlinking…" : "Unlink"}
          </Button>
        </div>
      ))}
      <ErrorNote error={unlinkError} />
      <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
        {(ctx?.skills ?? []).map((s) => (
          <CheckRow
            key={s.id}
            checked={pending.includes(s.id)}
            onChange={(v) =>
              setPending((p) => (v ? [...p, s.id] : p.filter((x) => x !== s.id)))
            }
            label={s.name ?? s.id}
            hint={s.description?.slice(0, 70)}
          />
        ))}
      </div>
      {inside.map((n) => (
        <div key={n} className="px-1.5 py-1">
          <span className="block truncate font-mono text-[11.5px]">{n}</span>
          <span className="block text-[10px] text-muted-foreground">Private to this agent: manage it in LangSmith.</span>
        </div>
      ))}
      {dirty && (
        <p className="text-[10px] text-muted-foreground">
          {toAdd.length > 0 && <>+{toAdd.length} to link. </>}
          {toRemove.length > 0 && <>−{toRemove.length} to unlink.</>}
        </p>
      )}
    </RailEditor>
  )
}
