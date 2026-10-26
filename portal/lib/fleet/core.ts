/**
 * A small, honest client for the LangSmith Headless Fleet API (`/v1/fleet/*`).
 *
 * Pure TypeScript with no Next.js imports, so the portal's route handlers AND the
 * headless `scripts/smoke.ts` share one definition of "a Fleet call" — the activity
 * drawer can never drift from what actually happened on the wire.
 *
 * Load-bearing behaviours, each checked against a live self-hosted install:
 *
 * 1. Identity. On self-hosted LangSmith with Fleet External Auth in OIDC mode, the portal
 *    sends the user's own access token from their identity provider (`Authorization:
 *    Bearer`). LangSmith checks the issuer, audience, signature and expiry, then resolves
 *    the subject claim to an existing LangSmith user, so RBAC, ABAC, access levels and
 *    thread scoping all apply per user. The token must only ever come from the server-side
 *    session — never from request input.
 * 2. A few routes are tenantless and must NOT carry a workspace header (`/orgs`,
 *    `/users/current`, `/orgs/{id}/tenants`).
 * 3. Streams are SSE: `event: metadata` once, then `values` / `messages` frames with
 *    `: heartbeat` comments between them. An interrupt is a `__interrupt__` KEY inside a
 *    values payload, not an event of its own. Long runs drop the stream while the run
 *    continues server-side — that surfaces here as `StreamInterrupted`, not a failure.
 */

export type FleetIdentity =
  /** Production: the user's own access token; self-hosted LangSmith with FLEET_EXTERNAL_AUTH_OIDC_ENABLED. */
  | { mode: "bearer"; token: string }
  /** Development only: one LangSmith credential for every portal user (SaaS PAT). */
  | { mode: "api-key"; apiKey: string }

export type CallRecord = {
  at: string
  user: string
  method: string
  path: string
  status: number | null
  duration_ms: number
  tenantless: boolean
  request_headers: Record<string, string>
  request_body: unknown
  response_body: unknown
  note?: string | null
  curl: string
}

const MASK = "••••••••"
const SECRET_HEADERS = new Set([
  "x-api-key",
  "authorization",
  "x-service-key",
  "x-langsmith-external-auth-secret",
])
// `value` is here because PUT /secrets/{name} carries the secret in a field of that name.
const SECRET_KEY = /(api[_-]?key|secret|token|password|credential|^value$)/i

/** Recursively mask secret-ish values. Shape is preserved — that is the teaching value. */
export function redact(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(redact)
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? (v ? MASK : v) : redact(v)
    }
    return out
  }
  return obj
}

export function redactHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(h)) out[k] = SECRET_HEADERS.has(k.toLowerCase()) ? MASK : v
  return out
}

/** Tenantless: the bootstrap chain you call BEFORE you know which workspace you want. */
export function isTenantless(path: string): boolean {
  const p = path.split("?", 1)[0]
  return (
    p === "/v1/fleet/orgs" ||
    p === "/v1/fleet/users/current" ||
    /^\/v1\/fleet\/orgs\/[^/]+\/tenants$/.test(p)
  )
}

export class FleetError extends Error {
  constructor(
    public method: string,
    public path: string,
    public status: number,
    public body: unknown,
  ) {
    const detail =
      body && typeof body === "object" && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : typeof body === "string"
          ? body
          : JSON.stringify(body)
    super(`${method} ${path} -> ${status}: ${detail}`)
  }

  /** Fleet's own one-line reason, bounded, never an internal stack. */
  get detail(): string {
    const b = this.body as { detail?: unknown; message?: unknown } | null
    return String(b?.detail ?? b?.message ?? `HTTP ${this.status}`).slice(0, 400)
  }

  get code(): string | undefined {
    const b = this.body as { code?: unknown; error_code?: unknown } | null
    const c = b?.code ?? b?.error_code
    return typeof c === "string" ? c : undefined
  }
}

/**
 * The upstream SSE connection dropped mid-run. **The run keeps going server-side** —
 * only our view of it ended. Callers re-read thread state instead of reporting failure.
 */
export class StreamInterrupted extends Error {}

// ── call log ────────────────────────────────────────────────────────────────────
// One in-memory ring buffer per portal user. Kept on globalThis so dev hot-reload does
// not wipe it. Single-process by design: with several replicas each one sees only the
// calls it served (the chart runs one). Only the most recently active LOG_USERS users keep
// a log, so memory stays bounded however many people sign in.
const LOG_LIMIT = 150
const LOG_USERS = 200
const g = globalThis as unknown as { __fleetCallLog?: Map<string, CallRecord[]> }
const callLog: Map<string, CallRecord[]> = (g.__fleetCallLog ??= new Map())

export function activityFor(user: string, limit = 80): CallRecord[] {
  return (callLog.get(user) ?? []).slice(-limit)
}
export function clearActivity(user: string): void {
  callLog.delete(user)
}
function record(rec: CallRecord) {
  const list = callLog.get(rec.user) ?? []
  list.push(rec)
  if (list.length > LOG_LIMIT) list.splice(0, list.length - LOG_LIMIT)
  // Re-insert so the Map's order is least → most recently active.
  callLog.delete(rec.user)
  callLog.set(rec.user, list)
  while (callLog.size > LOG_USERS) callLog.delete(callLog.keys().next().value as string)
}

function shellQuote(s: string): string {
  return /^[A-Za-z0-9_./:=@%+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
}

// ── client ──────────────────────────────────────────────────────────────────────
export type FleetClientOptions = {
  /** e.g. https://langsmith.example.com/api (self-hosted) or https://api.smith.langchain.com */
  baseUrl: string
  identity: FleetIdentity
  /** Workspace id sent on every workspace-scoped call. */
  tenantId?: string
  /** Whose activity log this client writes to (the portal user's subject). */
  logAs: string
  timeoutMs?: number
}

type RequestOpts = {
  body?: unknown
  query?: Record<string, string | number | boolean | undefined | null>
  note?: string
  /**
   * What the call log, Activity drawer and cURL show instead of a body, e.g. skill file
   * contents reduced to their sizes. Redaction still applies to the result.
   */
  summarizeBody?: (body: unknown) => unknown
}

export class FleetClient {
  readonly baseUrl: string
  private readonly host: string
  constructor(private opts: FleetClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "")
    this.host = new URL(this.baseUrl).host
  }

  get tenantId(): string | undefined {
    return this.opts.tenantId
  }

  /** Same identity, a different workspace — for the workspace switcher. */
  withTenant(tenantId: string | undefined): FleetClient {
    return new FleetClient({ ...this.opts, tenantId })
  }

  private url(path: string, query?: RequestOpts["query"]): string {
    if (!path.startsWith("/v1/")) throw new Error(`refusing non-Fleet path ${path}`)
    const u = new URL(this.baseUrl + path)
    // SSRF guard: whatever was concatenated, the request may only reach the Fleet host.
    if (u.host !== this.host) throw new Error(`refusing to call non-allowlisted host ${u.host}`)
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v))
    }
    return u.toString()
  }

  private headers(path: string, json: boolean, accept = "application/json"): Record<string, string> {
    const h: Record<string, string> = { Accept: accept }
    const id = this.opts.identity
    if (id.mode === "bearer") {
      h["Authorization"] = `Bearer ${id.token}`
    } else if (id.apiKey.startsWith("lsv2_")) {
      h["X-Api-Key"] = id.apiKey
    } else {
      h["Authorization"] = `Bearer ${id.apiKey}`
    }
    if (!isTenantless(path)) {
      if (!this.opts.tenantId) throw new Error(`${path} is workspace-scoped but no workspace is selected`)
      h["X-Tenant-Id"] = this.opts.tenantId
    }
    if (json) h["Content-Type"] = "application/json"
    return h
  }

  private curl(method: string, path: string, headers: Record<string, string>, body: unknown, summarized = false): string {
    const parts = ["curl", "-X", method, `${this.baseUrl}${path}`]
    for (const [k, v] of Object.entries(headers)) {
      if (k === "Accept" || k === "Content-Type") continue
      const placeholder =
        k === "X-Api-Key"
          ? "$LANGSMITH_API_KEY"
          : k === "Authorization"
            ? this.opts.identity.mode === "bearer"
              ? "Bearer $FLEET_USER_TOKEN"
              : "Bearer $LANGSMITH_TOKEN"
            : v
      parts.push("-H", `${k}: ${placeholder}`)
    }
    if (body !== undefined) parts.push("-H", "Content-Type: application/json", "-d", JSON.stringify(redact(body)))
    const line = parts.map(shellQuote).join(" ")
    return summarized ? `${line}  # body summarized: file contents replaced by their sizes` : line
  }

  private log(
    partial: Omit<CallRecord, "at" | "user" | "tenantless" | "curl">,
    headers: Record<string, string>,
    body: unknown,
    summarizeBody?: RequestOpts["summarizeBody"],
  ) {
    const pathOnly = partial.path
    const view = (b: unknown) => (summarizeBody && b !== undefined && b !== null ? summarizeBody(b) : b)
    record({
      ...partial,
      response_body: redact(view(partial.response_body)),
      at: new Date().toISOString(),
      user: this.opts.logAs,
      tenantless: isTenantless(pathOnly),
      request_headers: redactHeaders(headers),
      request_body: redact(view(body)),
      curl: this.curl(partial.method, pathOnly, headers, view(body), !!summarizeBody && body !== undefined),
    })
  }

  async request<T = unknown>(method: string, path: string, opts: RequestOpts = {}): Promise<T> {
    const headers = this.headers(path, opts.body !== undefined)
    const started = Date.now()
    const qs = opts.query ? new URL(this.url(path, opts.query)).search : ""
    let res: Response
    try {
      res = await fetch(this.url(path, opts.query), {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 120_000),
      })
    } catch (err) {
      this.log(
        { method, path: path + qs, status: null, duration_ms: Date.now() - started, request_headers: {}, request_body: null, response_body: { transport_error: String(err) }, note: opts.note },
        headers,
        opts.body,
        opts.summarizeBody,
      )
      throw err
    }
    const text = await res.text()
    let parsed: unknown = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = { raw: text.slice(0, 2000) }
      }
    }
    this.log(
      { method, path: path + qs, status: res.status, duration_ms: Date.now() - started, request_headers: {}, request_body: null, response_body: parsed, note: opts.note },
      headers,
      opts.body,
      opts.summarizeBody,
    )
    if (!res.ok) throw new FleetError(method, path, res.status, parsed)
    return parsed as T
  }

  get<T = unknown>(path: string, query?: RequestOpts["query"]) {
    return this.request<T>("GET", path, { query })
  }
  post<T = unknown>(path: string, body?: unknown, note?: string) {
    return this.request<T>("POST", path, { body: body ?? {}, note })
  }
  patch<T = unknown>(path: string, body: unknown, note?: string) {
    return this.request<T>("PATCH", path, { body, note })
  }
  put<T = unknown>(path: string, body?: unknown, note?: string) {
    return this.request<T>("PUT", path, { body, note })
  }
  del<T = unknown>(path: string, note?: string) {
    return this.request<T>("DELETE", path, { note })
  }

  /** Raw GET for binary downloads (sandbox file content). Logged without a body. */
  async raw(path: string, query?: RequestOpts["query"]): Promise<Response> {
    const headers = this.headers(path, false, "*/*")
    const started = Date.now()
    const res = await fetch(this.url(path, query), { headers, cache: "no-store" })
    this.log(
      { method: "GET", path, status: res.status, duration_ms: Date.now() - started, request_headers: {}, request_body: null, response_body: { content_type: res.headers.get("content-type") } },
      headers,
      undefined,
    )
    return res
  }

  /**
   * Yield parsed SSE frames `{event, data}` from a Fleet run. Heartbeat comments are
   * swallowed; CRLF is normalized before splitting records (the upstream runtime emits
   * `\r\n\r\n`, and a parser looking only for `\n\n` silently buffers the whole stream).
   * The exchange lands in the activity log once, with a frame summary as its body.
   */
  async *stream(path: string, body: unknown, note?: string, signal?: AbortSignal): AsyncGenerator<{ event: string; data: unknown }> {
    const headers = this.headers(path, true, "text/event-stream")
    const started = Date.now()
    const res = await fetch(this.url(path), { method: "POST", headers, body: JSON.stringify(body), signal })
    if (!res.ok || !res.body) {
      const text = await res.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = { raw: text.slice(0, 2000) }
      }
      this.log({ method: "POST", path, status: res.status, duration_ms: Date.now() - started, request_headers: {}, request_body: null, response_body: redact(parsed), note }, headers, body)
      throw new FleetError("POST", path, res.status, parsed)
    }

    const seen: Record<string, number> = {}
    let interrupted = false
    let dropped: string | null = null
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>
        try {
          chunk = await reader.read()
        } catch (err) {
          if (signal?.aborted) return
          dropped = err instanceof Error ? err.message : String(err)
          break
        }
        if (chunk.done) break
        buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n")
        const records = buffer.split("\n\n")
        buffer = records.pop() ?? ""
        for (const rec of records) {
          let event = "message"
          const data: string[] = []
          for (const line of rec.split("\n")) {
            if (!line || line.startsWith(":")) continue
            if (line.startsWith("event:")) event = line.slice(6).trim()
            else if (line.startsWith("data:")) data.push(line.slice(5).trim())
          }
          if (!data.length) continue
          let parsed: unknown
          try {
            parsed = JSON.parse(data.join("\n"))
          } catch {
            continue
          }
          seen[event] = (seen[event] ?? 0) + 1
          if (parsed && typeof parsed === "object" && "__interrupt__" in (parsed as object)) interrupted = true
          yield { event, data: parsed }
        }
      }
    } finally {
      this.log(
        {
          method: "POST",
          path,
          status: res.status,
          duration_ms: Date.now() - started,
          request_headers: {},
          request_body: null,
          response_body: { content_type: "text/event-stream", frames: seen, ended_with_interrupt: interrupted, ...(dropped ? { dropped } : {}) },
          note: note ?? "SSE stream",
        },
        headers,
        body,
      )
    }
    if (dropped) throw new StreamInterrupted(dropped)
  }
}

/** Retry the transient "upstream agent runtime returned an unexpected response" window. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4, delayMs = 1500): Promise<T> {
  let delay = delayMs
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (err) {
      const transient = err instanceof FleetError && [502, 503, 504].includes(err.status)
      if (!transient || i >= attempts) throw err
      await new Promise((r) => setTimeout(r, delay))
      delay *= 2
    }
  }
}
