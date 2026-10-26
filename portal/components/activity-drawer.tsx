"use client"

/**
 * The one place the platform underneath becomes visible.
 *
 * Collapsed, this reads as an ordinary internal-tool status strip. Expanded, it is the
 * proof: every `/v1/fleet/*` call the portal caused, with redacted headers and a
 * copyable cURL. The portal is deliberately organised around agents, not API steps —
 * this drawer is where the API story lives, on demand.
 */
import { useCallback, useEffect, useState } from "react"

import { clearActivity, getActivity } from "@/lib/api"
import type { ApiCall } from "@/lib/types"
import { Button, Icon, Mono } from "./ui"

function methodColour(method: string) {
  if (method === "GET") return "text-brand"
  if (method === "DELETE") return "text-destructive"
  return "text-[oklch(0.62_0.15_68)] dark:text-[oklch(0.80_0.13_76)]"
}

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-muted-foreground">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  )
}

export function ActivityDrawer({ refreshKey }: { refreshKey: number }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ApiCall[]>([])
  const [meta, setMeta] = useState<{ base_url: string; auth_mode: string } | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [copied, setCopied] = useState<number | null>(null)

  const load = useCallback(() => {
    getActivity()
      .then((a) => {
        setItems(a.items)
        setMeta({ base_url: a.base_url, auth_mode: a.auth_mode })
      })
      .catch(() => {
        /* the drawer is diagnostic; never let it break the page */
      })
  }, [])

  useEffect(load, [load, refreshKey])
  // Only poll while open — a closed drawer has no reason to generate traffic.
  useEffect(() => {
    if (!open) return
    const t = setInterval(load, 2500)
    return () => clearInterval(t)
  }, [open, load])

  const last = items[items.length - 1]

  return (
    <div className="border-t border-border/60 bg-background/85 backdrop-blur-md">
      <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs text-muted-foreground sm:px-5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-2 hover:text-foreground"
        >
          <Icon name="chevron" className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
          Fleet API activity
          <span className="text-border">·</span>
          {items.length} call{items.length === 1 ? "" : "s"}
        </button>
        {open ? (
          <div className="flex items-center gap-2">
            <Mono className="hidden text-[11px] sm:inline">{meta?.base_url}</Mono>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                clearActivity().then(load)
                setExpanded(null)
              }}
            >
              clear
            </Button>
          </div>
        ) : (
          last && (
            <span className="truncate">
              last: <Mono className="text-[11px]">{`${last.method} ${last.path}`}</Mono> ·{" "}
              {last.status} · {last.duration_ms} ms
            </span>
          )
        )}
      </div>

      {open && (
        <div className="max-h-[45svh] overflow-y-auto px-4 pb-4 sm:px-5">
          {/* Capped so an expanded drawer never squeezes the chat pane to nothing. */}
          <div className="overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-border/60">
            {items.length === 0 && (
              <p className="p-3 text-xs text-muted-foreground">
                No calls recorded yet. Interact with the portal and they appear here.
              </p>
            )}
            {items.map((call, i) => {
              const isOpen = expanded === i
              return (
                <div key={`${call.path}-${i}`} className="border-b border-border/60 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : i)}
                    className={`grid w-full grid-cols-[3.25rem_1fr_auto_auto] items-center gap-3 px-3.5 py-2 text-left text-xs transition-colors hover:bg-accent/50 ${
                      isOpen ? "bg-accent/50" : ""
                    }`}
                  >
                    <span className={`font-semibold tracking-wide ${methodColour(call.method)}`}>
                      {call.method}
                    </span>
                    <span className="truncate">
                      <Mono className="text-[11.5px] text-foreground">{call.path}</Mono>
                      {call.tenantless && (
                        <span className="ml-2 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
                          tenantless
                        </span>
                      )}
                    </span>
                    <span
                      className={
                        call.status && call.status < 400
                          ? "text-[oklch(0.52_0.13_155)] dark:text-[oklch(0.75_0.15_158)]"
                          : "text-destructive"
                      }
                    >
                      {call.status ?? "—"}
                    </span>
                    <span className="w-16 text-right text-muted-foreground">{call.duration_ms} ms</span>
                  </button>

                  {isOpen && (
                    <div className="border-t border-border/60">
                      <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/50 px-3.5 py-1.5">
                        <span className="text-[11px] text-muted-foreground">{call.note ?? ""}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            navigator.clipboard?.writeText(call.curl)
                            setCopied(i)
                            setTimeout(() => setCopied(null), 1500)
                          }}
                        >
                          {copied === i ? "copied" : "copy as cURL"}
                        </Button>
                      </div>
                      <div className="grid md:grid-cols-[1fr_1.35fr]">
                        <div className="p-3">
                          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Request
                          </p>
                          <Json value={call.request_headers} />
                          <div className="h-2" />
                          <Json value={call.request_body} />
                        </div>
                        <div className="border-t border-border/60 p-3 md:border-l md:border-t-0">
                          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Response
                          </p>
                          <Json value={call.response_body} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Only your own calls appear here. Credentials are masked at record time — your token is
            never shown, and the cURL uses a{" "}
            <Mono className="text-[11px]">$FLEET_USER_TOKEN</Mono> placeholder. Auth
            mode: {meta?.auth_mode}.
          </p>
        </div>
      )}
    </div>
  )
}
