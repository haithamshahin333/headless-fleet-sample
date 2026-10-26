"use client"

import { useEffect, useState } from "react"

import { getSandboxFiles, sandboxFileUrl } from "@/lib/api"
import { Button, Mono } from "./ui"

type Entry = { path: string; size?: number; dir?: boolean }

function normalize(res: unknown): Entry[] {
  const r = res as { items?: unknown[]; files?: unknown[] }
  const list = (r?.items ?? r?.files ?? []) as Record<string, unknown>[]
  return list
    .map((f) => ({
      path: String(f.path ?? f.name ?? ""),
      size: typeof f.size === "number" ? f.size : undefined,
      dir: f.is_dir === true || f.type === "directory" || f.type === "dir",
    }))
    .filter((f) => f.path)
}

/**
 * Files on the agent's computer (a LangSmith sandbox). Downloads go through this app,
 * which streams them as attachments — the browser never talks to the sandbox.
 */
export function FilesDrawer({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [path, setPath] = useState<string | undefined>(undefined)
  const [items, setItems] = useState<Entry[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setItems(null)
    getSandboxFiles(slug, path)
      .then((r) => setItems(normalize(r)))
      .catch((e) => setErr(e instanceof Error ? e.message : "could not list files"))
  }, [slug, path])

  return (
    <aside className="flex w-80 flex-none flex-col border-l bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <p className="text-[12.5px] font-semibold">🖥 Computer files</p>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="border-b px-3 py-1.5 text-[11px] text-muted-foreground">
        <Mono className="text-[10.5px]">{path ?? "/"}</Mono>
        {path && (
          <button className="ml-2 text-brand" onClick={() => setPath(path.split("/").slice(0, -1).join("/") || undefined)}>
            up
          </button>
        )}
      </p>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1 text-[12px]">
        {err && <li className="px-2 py-1 text-destructive">{err}</li>}
        {!err && items === null && <li className="px-2 py-1 text-muted-foreground">Loading…</li>}
        {items?.length === 0 && <li className="px-2 py-1 text-muted-foreground">No files yet.</li>}
        {items?.map((f) => (
          <li key={f.path} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-accent">
            {f.dir ? (
              <button className="min-w-0 flex-1 truncate text-left" onClick={() => setPath(f.path)}>
                📁 {f.path.split("/").pop()}
              </button>
            ) : (
              <a className="min-w-0 flex-1 truncate" href={sandboxFileUrl(slug, f.path)}>
                📄 {f.path.split("/").pop()}
              </a>
            )}
            {f.size !== undefined && <span className="text-[10px] text-muted-foreground">{f.size} B</span>}
          </li>
        ))}
      </ul>
    </aside>
  )
}
