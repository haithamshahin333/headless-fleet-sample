/**
 * The browser's only backend is this app's own route handlers (same origin). The
 * browser never holds a LangSmith credential, never sees the user's Fleet token, and never
 * calls the LangSmith host.
 */
import type {
  Activity,
  Agent,
  ApiErrorBody,
  Catalog,
  ComputerAccess,
  CreatedSkill,
  ConnectStart,
  Connection,
  Me,
  Readiness,
  SandboxPolicy,
  SkillUsage,
  Snapshot,
  StreamState,
  ThreadPage,
  ToolCatalog,
  User,
  WorkspaceSkill,
} from "./types"

/** An error that remembers WHO refused it — LangSmith or the portal — and why. */
export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody) {
    super(body.detail ?? `HTTP ${status}`)
  }
  get hint() {
    return this.body.hint
  }
  get enforcedBy() {
    return this.body.enforced_by
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const mutating = init?.method && init.method !== "GET"
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      // CSRF: a cross-site form cannot set custom headers.
      ...(mutating ? { "X-Portal-Request": "1" } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  })
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`
  }
  if (!res.ok) {
    let body: ApiErrorBody = { detail: res.statusText }
    try {
      body = await res.json()
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, body)
  }
  return (await res.json()) as T
}

const json = (body: unknown) => JSON.stringify(body)

// ── identity ────────────────────────────────────────────────────────────────────
export const getMe = () => req<Me>("/api/me")
export const switchWorkspace = (workspace_id: string) => req<{ ok: true }>("/api/workspace", { method: "POST", body: json({ workspace_id }) })

// ── catalogs ────────────────────────────────────────────────────────────────────
let catalogPromise: Promise<Catalog> | null = null
/** Cached for the page's life: the catalog is per user + workspace, both fixed per page. */
export const getCatalog = (fresh = false) => {
  if (fresh || !catalogPromise) catalogPromise = req<Catalog>("/api/catalog").catch((e) => ((catalogPromise = null), Promise.reject(e)))
  return catalogPromise
}
export const getSnapshots = async () => ({ items: (await getCatalog()).snapshots as Snapshot[] })
export const getPolicies = async () => ({ items: ((await getCatalog()).policies ?? []) as SandboxPolicy[] })

export async function getToolCatalog(opts: { integrationId: string }): Promise<ToolCatalog> {
  const r = await req<{ tools: ToolCatalog["tools"]; listable: boolean; detail: string | null }>(
    `/api/tool-catalog?integration_id=${encodeURIComponent(opts.integrationId)}`,
  )
  return { tools: r.tools, connected: r.listable, detail: r.detail }
}

// ── workspace skills ────────────────────────────────────────────────────────────
export const getSkills = () => req<{ items: WorkspaceSkill[] }>("/api/skills")
/** `files` is the final `{path: text}` map (already unpacked in the browser); `attach_to` links it to an agent. */
export const createSkill = (body: { name: string; files: Record<string, string>; attach_to?: string }) =>
  req<CreatedSkill>("/api/skills", { method: "POST", body: json(body) })
export const deleteSkill = (handle: string) => req<{ ok: true }>(`/api/skills/${encodeURIComponent(handle)}`, { method: "DELETE" })
export const getSkillUsage = (handle: string) => req<SkillUsage>(`/api/skills/${encodeURIComponent(handle)}/usage`)

// ── agents ──────────────────────────────────────────────────────────────────────
export const getAgents = () => req<{ owned: Agent[]; shared: Agent[]; published: Agent[] }>("/api/agents")
export const getAgent = (id: string) => req<Agent>(`/api/agents/${id}`)

export type ToolDraft = { name: string; mcp_server_url: string; mcp_server_name?: string; display_name?: string; require_approval?: boolean }
export type BackendDraft = { type: "state" } | { type: "sandbox"; scope: "thread" | "agent"; snapshot_id?: string; policy_ids?: string[] }
export type SubagentDraft = { name: string; description?: string; system_prompt?: string; model_id?: string; tools?: ToolDraft[] }
export type AgentDraft = {
  name: string
  description?: string
  model_id: string
  system_prompt?: string
  identity: "personal" | "shared"
  tools?: ToolDraft[]
  skills?: string[]
  subagents?: SubagentDraft[]
  backend?: BackendDraft
}

export const createAgent = (d: AgentDraft) => req<Agent>("/api/agents", { method: "POST", body: json(d) })
const patch = (id: string, body: unknown) => req<Agent>(`/api/agents/${id}`, { method: "PATCH", body: json(body) })
export const updateMeta = (id: string, name: string, description: string) => patch(id, { op: "meta", name, description })
export const putInstructions = (id: string, system_prompt: string) => patch(id, { op: "instructions", system_prompt })
export const putModel = (id: string, model_id: string) => patch(id, { op: "model", model_id })
/** Always the COMPLETE tool set — upstream replaces tools.json wholesale. */
export const putTools = (id: string, tools: ToolDraft[]) => patch(id, { op: "tools", tools })
export const putBackend = (id: string, body: { type: string; snapshot_id?: string | null; policy_ids?: string[]; scope?: string }) =>
  patch(id, {
    op: "backend",
    backend:
      body.type === "sandbox"
        ? { type: "sandbox", scope: body.scope === "agent" ? "agent" : "thread", snapshot_id: body.snapshot_id ?? undefined, policy_ids: body.policy_ids ?? [] }
        : { type: "state" },
  })
export const addSkill = (id: string, repo_handle: string) => req<Agent>(`/api/agents/${id}/skills`, { method: "POST", body: json({ repo_handle }) })
export const removeSkill = (id: string, handle: string) => req<Agent>(`/api/agents/${id}/skills/${encodeURIComponent(handle)}`, { method: "DELETE" })
/** Upsert ONE subagent by name. */
export const putSubagent = (id: string, body: SubagentDraft) => req<Agent>(`/api/agents/${id}/subagents`, { method: "PUT", body: json(body) })
export const deleteSubagent = (id: string, name: string) => req<Agent>(`/api/agents/${id}/subagents/${encodeURIComponent(name)}`, { method: "DELETE" })
export const cloneAgent = (id: string, name: string) => req<Agent>(`/api/agents/${id}/clone`, { method: "POST", body: json({ name }) })
export const deleteAgent = (id: string) => req<{ ok: true }>(`/api/agents/${id}`, { method: "DELETE" })
export const archiveAgent = (id: string) => req<Agent>(`/api/agents/${id}/archive`, { method: "POST" })
export const unarchiveAgent = (id: string) => req<Agent>(`/api/agents/${id}/archive`, { method: "DELETE" })
export const putPermissions = (
  id: string,
  p: { visibility: "user" | "tenant"; tenant_access_level: "read" | "run" | "write"; shared_users: { read: string[]; run: string[]; write: string[] } },
) => req<Agent>(`/api/agents/${id}/permissions`, { method: "PUT", body: json(p) })

// ── readiness & connections ─────────────────────────────────────────────────────
export const getReadiness = (agentId: string) => req<Readiness>(`/api/agents/${agentId}/readiness`)
/** Reuse or create YOUR Microsoft Graph access profile (Build > Computer); also strips an old host allow list from it. */
export const createGraphProfile = () => req<SandboxPolicy & { created: boolean }>("/api/computer-access", { method: "POST" })
/** Reuse or create YOUR Microsoft Graph access profile and attach it to this agent's computer. */
export const setUpComputerAccess = (agentId: string) =>
  req<ComputerAccess>(`/api/agents/${agentId}/computer-access`, { method: "POST" })
export const bindAgent = (agentId: string, provider_slug: string) =>
  req<{ bound: boolean }>(`/api/agents/${agentId}/bind`, { method: "POST", body: json({ provider_slug }) })
export const getConnections = () => req<{ items: Connection[] }>("/api/connections")
export const startConnect = (provider_slug: string, scopes: string[] = []) =>
  req<ConnectStart>("/api/connect", { method: "POST", body: json({ provider_slug, scopes }) })
export const pollConnect = (sessionId: string) => req<{ state: ConnectStart["state"] }>(`/api/connect/${encodeURIComponent(sessionId)}`)

// ── threads ─────────────────────────────────────────────────────────────────────
export const getInbox = (cursor?: string) => req<ThreadPage>(`/api/inbox${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`)
export const getThreads = (agentId: string, cursor?: string) =>
  req<ThreadPage>(`/api/agents/${agentId}/threads${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`)
export const createThread = (agentId: string, test_run = false) =>
  req<{ thread_id: string }>(`/api/agents/${agentId}/threads`, { method: "POST", body: json({ test_run }) })
export const getThreadState = (threadId: string) => req<StreamState & { status?: string; agent_id?: string }>(`/api/threads/${threadId}`)

// ── people, files, activity ─────────────────────────────────────────────────────
export const searchUsers = (search: string) => req<{ items: User[] }>(`/api/users?search=${encodeURIComponent(search)}`)
export const getSandboxFiles = (slug: string, path?: string) =>
  req<{ items?: { path?: string; name?: string; size?: number; is_dir?: boolean; type?: string }[]; files?: unknown[] }>(
    `/api/sandboxes/${encodeURIComponent(slug)}/files${path ? `?path=${encodeURIComponent(path)}` : ""}`,
  )
export const sandboxFileUrl = (slug: string, path: string) => `/api/sandboxes/${encodeURIComponent(slug)}/content?path=${encodeURIComponent(path)}`
export const getActivity = () => req<Activity>("/api/activity?limit=80")
export const clearActivity = () => req<{ ok: true }>("/api/activity", { method: "DELETE" })

// ── streaming ───────────────────────────────────────────────────────────────────
export type StreamHandlers = {
  onState: (s: StreamState) => void
  onToken?: (text: string) => void
  onStep?: (toolName: string) => void
}

/**
 * Consume the route handler's normalized SSE. `state` frames carry the whole message
 * list (replace, don't append); `done` settles the UI deterministically.
 */
export async function streamRun(path: string, body: unknown, handlers: StreamHandlers, signal?: AbortSignal): Promise<StreamState | null> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Portal-Request": "1" },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    let b: ApiErrorBody = { detail: `stream failed: ${res.status}` }
    try {
      b = await res.json()
    } catch {
      /* keep */
    }
    throw new ApiError(res.status, b)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let last: StreamState | null = null
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n")
    const chunks = buffer.split("\n\n")
    buffer = chunks.pop() ?? ""
    for (const chunk of chunks) {
      let event = "message"
      const data: string[] = []
      for (const line of chunk.split("\n")) {
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
      if (event === "error") throw new ApiError(400, parsed as ApiErrorBody)
      if (event === "token") handlers.onToken?.((parsed as { text: string }).text)
      else if (event === "step") handlers.onStep?.((parsed as { name: string }).name)
      else if (event === "state") {
        last = parsed as StreamState
        handlers.onState(last)
      } else if (event === "done" && last) {
        const d = parsed as Partial<StreamState>
        const prev: StreamState = last
        last = { ...prev, interrupt: d.interrupt ?? null, recovered: d.recovered ?? prev.recovered, thread_status: d.thread_status ?? prev.thread_status }
        handlers.onState(last)
      }
    }
  }
  return last
}

export const sendMessage = (threadId: string, agentId: string, text: string, h: StreamHandlers, signal?: AbortSignal) =>
  streamRun(`/api/threads/${threadId}/messages`, { agent_id: agentId, text }, h, signal)

export const resumeApproval = (threadId: string, agentId: string, decision: string, message: string | null, h: StreamHandlers, signal?: AbortSignal) =>
  streamRun(`/api/threads/${threadId}/resume`, { agent_id: agentId, kind: "approval", decision, message }, h, signal)

export const resumeAuth = (threadId: string, agentId: string, action: "continue" | "skip", h: StreamHandlers, signal?: AbortSignal) =>
  streamRun(`/api/threads/${threadId}/resume`, { agent_id: agentId, kind: "auth", action }, h, signal)
export const resolveUsers = (ids: string[]) =>
  ids.length ? req<{ items: User[] }>(`/api/users?ids=${ids.map(encodeURIComponent).join(",")}`) : Promise.resolve({ items: [] as User[] })
