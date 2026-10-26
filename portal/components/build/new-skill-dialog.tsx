"use client"

import clsx from "clsx"
import { useEffect, useMemo, useState } from "react"

import { createSkill } from "@/lib/api"
import { collect, finalize, findSecrets, folderSources, Refused, writtenSkill, type Bundle } from "@/lib/skills/bundle"
import { MAX_DESCRIPTION, utf8Bytes } from "@/lib/skills/rules"
import { zipSources } from "@/lib/skills/zip"
import type { CreatedSkill } from "@/lib/types"
import { ErrorNote } from "../error-note"
import { inputClass } from "../rail/RailEditor"
import { Button, Icon, Tag } from "../ui"

type Source = "write" | "folder" | "zip"
const SOURCES: [Source, string][] = [
  ["write", "Write"],
  ["folder", "Upload a folder"],
  ["zip", "Upload a .zip"],
]

const kb = (n: number) => (n < 1000 ? `${n} B` : n < 1e6 ? `${(n / 1e3).toFixed(1)} KB` : `${(n / 1e6).toFixed(2)} MB`)
const warnClass = "rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px]"

/**
 * New WORKSPACE skill: write it, or upload a folder or a .zip. All three end in the same
 * Review, where every file left out, every change the portal makes to SKILL.md, and any
 * secret-looking line is shown before anything is sent.
 *
 * The upload is unpacked and checked HERE, in the browser; the server receives only the
 * resulting text files and checks them again.
 */
export function NewSkillDialog({
  attachTo,
  draft,
  onCreated,
  onClose,
}: {
  /** An existing agent: the new skill is linked to it right away. */
  attachTo?: string
  /** The new-agent page: the skill is created now, even if the draft is abandoned. */
  draft?: boolean
  onCreated: (r: CreatedSkill) => void
  onClose: () => void
}) {
  const [source, setSource] = useState<Source>("zip")
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [instructions, setInstructions] = useState("")
  const [refusal, setRefusal] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [partial, setPartial] = useState<CreatedSkill | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const fin = useMemo(() => (bundle ? finalize(bundle.files, name, description) : null), [bundle, name, description])

  function review(b: Bundle) {
    setBundle(b)
    setName(b.name)
    setDescription(b.description)
    setRefusal(null)
  }

  async function load(run: () => Promise<Bundle>) {
    setBusy(true)
    setRefusal(null)
    try {
      review(await run())
    } catch (e) {
      setRefusal(e instanceof Refused ? e.message : `Could not read this upload: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  function fromWrite() {
    const files = writtenSkill(name, description, instructions)
    setBundle({ files, skipped: [], bytes: utf8Bytes(files["SKILL.md"]), name, description, secrets: findSecrets(files) })
  }

  async function create() {
    if (!fin || fin.problem) return
    setBusy(true)
    setError(null)
    try {
      const r = await createSkill({ name, files: fin.files, attach_to: attachTo })
      onCreated(r)
      if (r.attach_error) setPartial(r)
      else onClose()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New skill"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-[min(42rem,95vw)] flex-col overflow-hidden rounded-2xl bg-card shadow-pop ring-1 ring-border/60"
      >
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
          <h2 className="text-[14px] font-semibold tracking-tight">{bundle ? "Review the new skill" : "New skill"}</h2>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          {partial ? (
            <div className="flex flex-col gap-3 text-[13px]">
              <p>
                <b>{partial.skill.name}</b> was created in the workspace, but it was <b>not added to this agent</b>.
              </p>
              <ErrorNote error={new Error(partial.attach_error ?? "")} />
              <p className="text-[12px] text-muted-foreground">You can add it from Capabilities › Skills.</p>
            </div>
          ) : !bundle ? (
            <SourceStep
              source={source}
              setSource={setSource}
              busy={busy}
              refusal={refusal}
              name={name}
              setName={setName}
              description={description}
              setDescription={setDescription}
              instructions={instructions}
              setInstructions={setInstructions}
              onWrite={fromWrite}
              onFolder={(list) => {
                const { sources, folder } = folderSources(list)
                void load(() => collect(sources, folder))
              }}
              onZip={(file) =>
                void load(async () => {
                  const { sources, unreadable } = await zipSources(file)
                  const b = await collect(sources, file.name.replace(/\.zip$/i, ""))
                  return { ...b, skipped: [...unreadable.map((path) => ({ path, reason: "name is not UTF-8" })), ...b.skipped] }
                })
              }
            />
          ) : (
            <ReviewStep bundle={bundle} fin={fin!} name={name} setName={setName} description={description} setDescription={setDescription} draft={draft} attachTo={attachTo} />
          )}
          <ErrorNote error={error} />
        </div>

        {bundle && !partial && (
          <div className="flex items-center justify-between gap-2 border-t border-border/60 px-5 py-3">
            <Button
              variant="ghost"
              onClick={() => {
                setBundle(null)
                setError(null)
              }}
              disabled={busy}
            >
              Back
            </Button>
            <Button variant="primary" onClick={create} disabled={busy || !!fin?.problem}>
              {busy ? "Creating…" : attachTo ? "Create and add to agent" : "Create skill"}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function SourceStep(p: {
  source: Source
  setSource: (s: Source) => void
  busy: boolean
  refusal: string | null
  name: string
  setName: (s: string) => void
  description: string
  setDescription: (s: string) => void
  instructions: string
  setInstructions: (s: string) => void
  onWrite: () => void
  onFolder: (files: FileList) => void
  onZip: (file: File) => void
}) {
  const pick = "flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center text-[13px] transition-colors hover:bg-accent/40"
  return (
    <>
      <div className="inline-flex w-fit gap-0.5 rounded-full bg-secondary/70 p-1 dark:bg-muted" role="tablist">
        {SOURCES.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={p.source === k}
            onClick={() => p.setSource(k)}
            className={clsx(
              "rounded-full px-3.5 py-1.5 text-[12.5px] transition-colors",
              p.source === k ? "bg-background font-medium text-foreground shadow-card dark:bg-accent" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {p.source === "write" && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-[12.5px] font-medium">
            Name
            <input className={inputClass} value={p.name} onChange={(e) => p.setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))} placeholder="sales-research" />
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-medium">
            Description
            <textarea className={`${inputClass} min-h-16`} maxLength={MAX_DESCRIPTION} value={p.description} onChange={(e) => p.setDescription(e.target.value)} placeholder="When the agent should use this skill, in one or two sentences." />
          </label>
          <label className="flex flex-col gap-1.5 text-[12.5px] font-medium">
            Instructions
            <textarea className={`${inputClass} min-h-40 font-mono text-[12px] leading-relaxed`} value={p.instructions} onChange={(e) => p.setInstructions(e.target.value)} placeholder="# How to do it&#10;&#10;Step-by-step guidance, in Markdown." />
          </label>
          <div className="flex justify-end">
            <Button variant="primary" onClick={p.onWrite} disabled={!p.name || !p.description.trim() || !p.instructions.trim()}>
              Review
            </Button>
          </div>
        </div>
      )}

      {p.source === "folder" && (
        <label className={pick}>
          <Icon name="plus" className="h-5 w-5 text-muted-foreground" />
          <span className="font-medium">{p.busy ? "Reading…" : "Choose a skill folder"}</span>
          <span className="text-[12px] text-muted-foreground">The folder that holds SKILL.md. Text files only; images and other binaries are skipped.</span>
          <input
            type="file"
            className="sr-only"
            multiple
            {...({ webkitdirectory: "" } as Record<string, string>)}
            onClick={(e) => (e.currentTarget.value = "")}
            onChange={(e) => e.target.files?.length && p.onFolder(e.target.files)}
          />
        </label>
      )}

      {p.source === "zip" && (
        <label className={pick}>
          <Icon name="plus" className="h-5 w-5 text-muted-foreground" />
          <span className="font-medium">{p.busy ? "Unpacking…" : "Choose a .zip"}</span>
          <span className="text-[12px] text-muted-foreground">One skill: a SKILL.md and its files, at the top or in one folder. Unpacked in your browser.</span>
          <input type="file" className="sr-only" accept=".zip,application/zip" onClick={(e) => (e.currentTarget.value = "")} onChange={(e) => e.target.files?.[0] && p.onZip(e.target.files[0])} />
        </label>
      )}

      {p.refusal && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-[12.5px] text-destructive" role="alert">
          <span className="mr-2 rounded-full border border-destructive/40 px-1.5 text-[10px] font-semibold uppercase tracking-wider">Portal</span>
          {p.refusal}
        </div>
      )}
    </>
  )
}

function ReviewStep({
  bundle,
  fin,
  name,
  setName,
  description,
  setDescription,
  draft,
  attachTo,
}: {
  bundle: Bundle
  fin: ReturnType<typeof finalize>
  name: string
  setName: (s: string) => void
  description: string
  setDescription: (s: string) => void
  draft?: boolean
  attachTo?: string
}) {
  const files = Object.entries(fin.files).sort(([a], [b]) => (a === "SKILL.md" ? -1 : b === "SKILL.md" ? 1 : a.localeCompare(b)))
  const total = files.reduce((n, [, t]) => n + utf8Bytes(t), 0)
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <label className="flex flex-col gap-1.5 text-[12.5px] font-medium">
          Name
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-[12.5px] font-medium">
          Description
          <textarea className={`${inputClass} min-h-16`} maxLength={MAX_DESCRIPTION} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="When should the agent use this skill?" />
        </label>
      </div>

      {fin.problem && (
        <p className="text-[12.5px] text-destructive" role="alert">
          {fin.problem}
        </p>
      )}

      {fin.changes.length > 0 && (
        <div className="rounded-xl bg-secondary/60 px-3 py-2 text-[12px] dark:bg-muted">
          <p className="mb-1 font-medium">The portal will update SKILL.md so it matches:</p>
          {fin.changes.map((c) => (
            <p key={c.field} className="font-mono text-[11.5px] text-muted-foreground">
              {c.field}: {c.before === null ? <i>missing</i> : <s>{c.before.length > 80 ? c.before.slice(0, 80) + "…" : c.before}</s>} → {c.after.length > 80 ? c.after.slice(0, 80) + "…" : c.after}
            </p>
          ))}
        </div>
      )}

      <div>
        <p className="mb-1.5 flex items-center justify-between text-[12.5px] font-medium">
          <span>
            {files.length} file{files.length === 1 ? "" : "s"}
          </span>
          <span className="font-normal text-muted-foreground">{kb(total)} of 4 MB</span>
        </p>
        <ul className="max-h-44 overflow-y-auto rounded-xl ring-1 ring-border/70">
          {files.map(([path, text]) => (
            <li key={path} className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-1.5 text-[12px] last:border-0">
              <span className="truncate font-mono">{path}</span>
              <span className="flex-none text-muted-foreground">{kb(utf8Bytes(text))}</span>
            </li>
          ))}
        </ul>
      </div>

      {bundle.skipped.length > 0 && (
        <details className="text-[12px]">
          <summary className="cursor-pointer text-muted-foreground">
            {bundle.skipped.length} file{bundle.skipped.length === 1 ? "" : "s"} left out
          </summary>
          <ul className="mt-1.5 max-h-36 overflow-y-auto rounded-xl ring-1 ring-border/70">
            {bundle.skipped.map((s, i) => (
              <li key={`${s.path}-${i}`} className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-1.5 last:border-0">
                <span className="truncate font-mono">{s.path}</span>
                <span className="flex-none text-muted-foreground">{s.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {bundle.secrets.length > 0 && (
        <div className={warnClass}>
          ⚠ These lines look like they hold a secret. Everyone in the workspace will be able to read them:
          <ul className="mt-1 font-mono text-[11.5px] text-muted-foreground">
            {bundle.secrets.map((s) => (
              <li key={`${s.path}:${s.line}`}>
                {s.path}:{s.line} ({s.kind})
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-1.5 text-[12px] text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <Tag className="h-5 text-[10.5px]">Workspace skill</Tag>
          Everyone in this workspace can read this skill. Agents that use it can repeat its text.
        </p>
        {draft && <p>The skill is created now and stays in the workspace even if you don&apos;t create this agent.</p>}
        {attachTo && <p>It is added to this agent as soon as it is created.</p>}
      </div>
    </>
  )
}
