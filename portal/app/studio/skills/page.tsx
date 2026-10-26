"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { BuilderOnly } from "@/components/builder-only"
import { DeleteSkillDialog } from "@/components/build/delete-skill-dialog"
import { NewSkillDialog } from "@/components/build/new-skill-dialog"
import { ErrorNote } from "@/components/error-note"
import { Shell, useMe } from "@/components/shell"
import { Button, Icon, surfaceClass, Tag } from "@/components/ui"
import { getCatalog, getSkills } from "@/lib/api"
import type { WorkspaceSkill } from "@/lib/types"

/**
 * BUILD › Skills — the workspace skill library. Everyone in the workspace can read these;
 * LangSmith lets only a skill's creator delete it. Creating one here does not add it to
 * any agent (do that from an agent's Capabilities › Skills).
 */
function Skills() {
  const { me } = useMe()
  const [skills, setSkills] = useState<WorkspaceSkill[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<WorkspaceSkill | null>(null)

  const load = useCallback(() => {
    getSkills()
      .then((r) => setSkills(r.items))
      .catch(setError)
  }, [])
  useEffect(load, [load])

  if (me && !me.can_build) return <BuilderOnly me={me} what="Building agents" />

  const unknownOwner = !!skills?.some((s) => s.mine === null)
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/studio" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground">
            <Icon name="chevron" className="h-3 w-3 rotate-180" />
            Build
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Skills</h1>
          <p className="mt-1.5 text-[13.5px] text-muted-foreground">The workspace skill library. Everyone in this workspace can read these skills.</p>
        </div>
        <Button variant="primary" size="lg" onClick={() => setCreating(true)}>
          <Icon name="plus" className="h-4 w-4" />
          New skill
        </Button>
      </div>
      <ErrorNote error={error} />
      {!skills && !error && <p className="text-[13px] text-muted-foreground">Loading…</p>}
      {skills?.length === 0 && (
        <div className={`${surfaceClass} flex flex-col items-center gap-3 px-6 py-12 text-center`}>
          <p className="text-[14px] font-medium">No skills in this workspace yet.</p>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Icon name="plus" />
            Write or upload one
          </Button>
        </div>
      )}
      {!!skills?.length && (
        <ul className={`${surfaceClass} flex flex-col divide-y divide-border/60 overflow-hidden`}>
          {skills.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-accent/40">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-secondary text-muted-foreground dark:bg-accent">
                <Icon name="sparkle" className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-[14px] font-semibold tracking-tight">
                  {s.name ?? s.id}
                  {s.name && s.name !== s.id && <span className="font-mono text-[11.5px] font-normal text-muted-foreground">{s.id}</span>}
                </p>
                <p className="line-clamp-2 text-[12px] text-muted-foreground">{s.description || <i>No description</i>}</p>
              </div>
              {s.mine && <span className="inline-flex h-5 flex-none items-center rounded-full bg-brand-subtle px-2 text-[10.5px] font-medium text-brand">Yours</span>}
              {s.file_count != null && <Tag className="h-5 text-[10.5px]">{s.file_count} files</Tag>}
              {s.mine !== false && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => setDeleting(s)}
                  title={s.mine === null ? "LangSmith decides: only the skill's creator can delete it" : undefined}
                >
                  Delete
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {unknownOwner && (
        <p className="text-[12px] text-muted-foreground">
          The portal can&apos;t tell who created these skills with your current sign-in, so Delete shows on all of them. LangSmith refuses to delete a skill you didn&apos;t create.
        </p>
      )}

      {creating && (
        <NewSkillDialog
          onCreated={() => {
            load()
            void getCatalog(true)
          }}
          onClose={() => setCreating(false)}
        />
      )}
      {deleting && (
        <DeleteSkillDialog
          skill={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => {
            setDeleting(null)
            load()
            void getCatalog(true)
          }}
        />
      )}
    </div>
  )
}

export default function Page() {
  return (
    <Shell>
      <Skills />
    </Shell>
  )
}
