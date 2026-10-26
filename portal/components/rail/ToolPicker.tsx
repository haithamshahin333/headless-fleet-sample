"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { getConnections, getToolCatalog, type ToolDraft } from "@/lib/api"
import type { CatalogTool, Connection, Integration } from "@/lib/types"
import { providerFor, useConnect } from "@/lib/use-connect"
import { Button, Mono } from "../ui"

/**
 * Two-pane tool picker in a dialog.
 *
 * It lives in a modal rather than the rail because the rail is ~256px wide: a native
 * select with twenty servers overflowed it and covered the chat, tool descriptions were
 * unreadable, and taking tools from two servers meant two round trips through a dropdown.
 *
 * Connection state for all servers comes from ONE call to `/api/connections` — mapping
 * each integration's OAuth provider slug to a held token — rather than fetching twenty
 * tool catalogs up front. A server's actual tool list is fetched lazily when selected,
 * then cached for the life of the dialog.
 *
 * Two signals, deliberately kept apart: the catalog's `connected` only says the server
 * was LISTABLE — `GET /v1/fleet/integrations/{id}/tools` returns 200 for Gmail with no
 * Google token held — while the held-token check says whether a run would actually be
 * authorized. The Connect banner keys off the second; the tool list off the first.
 */
type Cached = { tools: CatalogTool[]; connected: boolean; detail?: string | null }

export function ToolPicker({
  integrations,
  attached,
  bindAgentId,
  initialId,
  onClose,
  onAdd,
}: {
  integrations: Integration[]
  attached: ToolDraft[]
  /** Only for shared-identity agents: connecting also binds the token to the agent. */
  bindAgentId?: string
  /** Open with this integration selected (from the Build catalog). */
  initialId?: string
  onClose: () => void
  onAdd: (tools: ToolDraft[]) => void
}) {
  const [serverQuery, setServerQuery] = useState("")
  const [toolQuery, setToolQuery] = useState("")
  const [activeId, setActiveId] = useState<string | null>(initialId ?? null)
  const [cache, setCache] = useState<Record<string, Cached>>({})
  const [loading, setLoading] = useState(false)
  const [tokens, setTokens] = useState<Connection[] | null>(null)
  const [picked, setPicked] = useState<ToolDraft[]>([])
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
    getConnections().then((r) => setTokens(r.items)).catch(() => setTokens([]))
    if (initialId) void load(initialId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Escape closes, as a dialog should.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  /** Cheap connection guess for all servers, from held tokens. */
  const heldSlugs = useMemo(
    () => new Set((tokens ?? []).map((t) => t.provider_slug).filter(Boolean) as string[]),
    [tokens],
  )
  function likelyConnected(i: Integration): boolean | null {
    const { slug } = providerFor(i)
    if (!slug) return true // no OAuth to do — nothing to connect
    if (tokens === null) return null // still loading; don't guess
    return heldSlugs.has(slug)
  }

  const attachedCount = useCallback(
    (i: Integration) =>
      [...attached, ...picked].filter((t) => t.mcp_server_url === i.url).length,
    [attached, picked],
  )

  const servers = useMemo(() => {
    const q = serverQuery.trim().toLowerCase()
    const list = q
      ? integrations.filter((i) => (i.name ?? "").toLowerCase().includes(q))
      : integrations
    // Servers you already use first, then the rest alphabetically — the ones you are
    // most likely to want again are at the top.
    return [...list].sort((a, b) => {
      const d = attachedCount(b) - attachedCount(a)
      return d !== 0 ? d : (a.name ?? "").localeCompare(b.name ?? "")
    })
  }, [integrations, serverQuery, attachedCount])

  const active = integrations.find((i) => i.id === activeId)
  const activeCache = activeId ? cache[activeId] : undefined
  const { slug, scopes } = providerFor(active)
  // Held-token check for the selected server: `false` means a run would fail with
  // "credential resolution failed" even though the catalog below lists fine.
  const tokenMissing = active ? likelyConnected(active) === false : false

  const load = useCallback(
    async (id: string, force = false) => {
      if (!force && cache[id]) return
      setLoading(true)
      try {
        const c = await getToolCatalog({ integrationId: id })
        setCache((prev) => ({
          ...prev,
          [id]: { tools: c.tools, connected: c.connected, detail: c.detail },
        }))
      } catch {
        setCache((prev) => ({ ...prev, [id]: { tools: [], connected: false } }))
      } finally {
        setLoading(false)
      }
    },
    [cache],
  )

  const conn = useConnect(bindAgentId, () => {
    if (activeId) void load(activeId, true)
    // The dot on the left is token-derived; refresh tokens so it turns green too.
    getConnections()
      .then((r) => setTokens(r.items))
      .catch(() => {})
  })
  const connecting = conn.state === "connecting" || conn.state === "waiting"

  function select(id: string) {
    setActiveId(id)
    setToolQuery("")
    void load(id)
  }

  const isPicked = (name: string) => picked.some((p) => p.name === name)
  const isAttached = (name: string) => attached.some((a) => a.name === name)

  function toggle(tool: CatalogTool, on: boolean) {
    if (!active) return
    setPicked((prev) =>
      on
        ? [
            ...prev,
            {
              name: tool.name,
              mcp_server_url: active.url ?? "",
              mcp_server_name: active.name ?? active.url ?? "",
              require_approval: false,
            },
          ]
        : prev.filter((p) => p.name !== tool.name),
    )
  }

  const tools = useMemo(() => {
    const q = toolQuery.trim().toLowerCase()
    const list = activeCache?.tools ?? []
    return q
      ? list.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            (t.description ?? "").toLowerCase().includes(q),
        )
      : list
  }, [activeCache, toolQuery])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add tools"
        onClick={(e) => e.stopPropagation()}
        className="flex h-[min(36rem,85vh)] w-[min(54rem,95vw)] flex-col overflow-hidden rounded-2xl bg-card shadow-pop ring-1 ring-border/60"
      >
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
          <h2 className="text-[14px] font-semibold tracking-tight">Add tools</h2>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[15rem_1fr]">
          {/* servers */}
          <div className="flex min-h-0 flex-col border-r border-border/60 bg-muted/40">
            <input
              ref={searchRef}
              value={serverQuery}
              onChange={(e) => setServerQuery(e.target.value)}
              placeholder="Search servers…"
              className="border-b bg-transparent px-3 py-2 text-[12px] outline-none placeholder:text-muted-foreground"
            />
            <ul className="min-h-0 flex-1 overflow-y-auto p-1">
              {servers.map((i) => {
                const on = likelyConnected(i)
                const count = attachedCount(i)
                const locked = i.can_invoke === false
                return (
                  <li key={i.id}>
                    <button
                      type="button"
                      disabled={locked}
                      title={locked ? "Restricted by your LangSmith admin (role or access policy)" : undefined}
                      onClick={() => select(i.id)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors ${
                        activeId === i.id ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
                      }`}
                    >
                      <span
                        aria-hidden
                        title={on === null ? "checking" : on ? "connected" : "not connected"}
                        className="h-1.5 w-1.5 flex-none rounded-full"
                        style={{
                          background:
                            on === null
                              ? "var(--muted-foreground)"
                              : on
                                ? "oklch(0.62 0.15 155)"
                                : "var(--destructive)",
                          opacity: on === null ? 0.4 : 1,
                        }}
                      />
                      <span className={`min-w-0 flex-1 truncate ${locked ? "text-muted-foreground line-through" : ""}`}>{i.name}</span>
                      {locked && <span className="flex-none text-[10px] text-muted-foreground">🔒 admin</span>}
                      {count > 0 && (
                        <span className="flex-none rounded-full bg-brand-subtle px-1.5 text-[10px] text-brand">
                          {count}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
              {servers.length === 0 && (
                <li className="px-2 py-2 text-[11.5px] text-muted-foreground">No match.</li>
              )}
            </ul>
          </div>

          {/* tools */}
          <div className="flex min-h-0 flex-col">
            {!active ? (
              <div className="grid flex-1 place-items-center px-6 text-center">
                <p className="max-w-[36ch] text-[12.5px] text-muted-foreground">
                  Pick a tool server on the left. A green dot means you already hold a
                  token for it.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 border-b px-3 py-2">
                  <input
                    value={toolQuery}
                    onChange={(e) => setToolQuery(e.target.value)}
                    placeholder={`Search ${active.name} tools…`}
                    className="flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground"
                  />
                  <Mono className="flex-none text-[10px] text-muted-foreground">
                    {activeCache ? `${activeCache.tools.length} tools` : ""}
                  </Mono>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {loading && <p className="p-2 text-[12px] text-muted-foreground">Loading…</p>}

                  {!loading && activeCache && (!activeCache.connected || tokenMissing) && (
                    <div className="m-1 flex flex-col gap-2 rounded-xl bg-brand-subtle p-3 ring-1 ring-brand-border">
                      <p className="text-[12px] leading-relaxed">
                        {activeCache.connected ? (
                          <>
                            <b>You haven&rsquo;t connected {active.name}.</b> Its tools are
                            listed below, but they will fail at run time until you
                            authorize it.
                          </>
                        ) : (
                          <>
                            <b>{active.name} isn&rsquo;t connected.</b> Authorize it and its
                            tools will appear here.
                          </>
                        )}
                      </p>
                      {slug ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={connecting}
                            onClick={() => conn.connect(slug, scopes)}
                          >
                            {connecting ? "Connecting…" : `Connect ${active.name}`}
                          </Button>
                          {conn.consentUrl && (
                            <a
                              href={conn.consentUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-[11px] text-brand underline underline-offset-2"
                            >
                              open consent page
                            </a>
                          )}
                          {conn.note && (
                            <span className="text-[11px] text-muted-foreground">{conn.note}</span>
                          )}
                        </div>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">
                          No OAuth provider is registered for this server.
                        </p>
                      )}
                      {activeCache.detail && (
                        <Mono className="text-[10px] text-muted-foreground">
                          {activeCache.detail}
                        </Mono>
                      )}
                    </div>
                  )}

                  {!loading &&
                    activeCache?.connected &&
                    tools.map((t) => {
                      const already = isAttached(t.name)
                      const chosen = isPicked(t.name)
                      const entry = picked.find((p) => p.name === t.name)
                      return (
                        <label
                          key={t.name}
                          className={`flex cursor-pointer items-start gap-2.5 rounded-md p-2 ${
                            already ? "opacity-60" : "hover:bg-accent/50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={already}
                            checked={already || chosen}
                            onChange={(e) => toggle(t, e.target.checked)}
                            className="mt-0.5 h-3.5 w-3.5 flex-none accent-[var(--brand)]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <Mono className="text-[12px] font-medium">{t.name}</Mono>
                              {already && (
                                <span className="rounded-full border px-1.5 text-[9.5px] text-muted-foreground">
                                  attached
                                </span>
                              )}
                            </span>
                            {t.description && (
                              <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                                {t.description.length > 220
                                  ? `${t.description.slice(0, 220)}…`
                                  : t.description}
                              </span>
                            )}
                          </span>
                          {chosen && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault()
                                setPicked((prev) =>
                                  prev.map((p) =>
                                    p.name === t.name
                                      ? { ...p, require_approval: !p.require_approval }
                                      : p,
                                  ),
                                )
                              }}
                              className={`mt-0.5 flex-none rounded-full border px-2 text-[10px] ${
                                entry?.require_approval
                                  ? "border-brand-border bg-brand-subtle text-brand"
                                  : "text-muted-foreground"
                              }`}
                              title="Require human approval before this tool runs"
                            >
                              {entry?.require_approval ? "approval" : "auto"}
                            </button>
                          )}
                        </label>
                      )
                    })}

                  {!loading && activeCache?.connected && tools.length === 0 && (
                    <p className="p-2 text-[12px] text-muted-foreground">
                      {activeCache.tools.length === 0
                        ? "This server exposes no tools."
                        : "No tool matches that search."}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-4 py-2.5">
          <p className="text-[11.5px] text-muted-foreground">
            {picked.length === 0
              ? "Nothing selected yet."
              : `${picked.length} tool${picked.length === 1 ? "" : "s"} to add` +
                ` from ${new Set(picked.map((p) => p.mcp_server_name)).size} server${
                  new Set(picked.map((p) => p.mcp_server_name)).size === 1 ? "" : "s"
                }`}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={picked.length === 0}
              onClick={() => {
                onAdd(picked)
                onClose()
              }}
            >
              Add {picked.length > 0 ? picked.length : ""}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
