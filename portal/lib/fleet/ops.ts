/**
 * Fleet operations as plain functions over `FleetClient` — one definition shared by the
 * portal's route handlers and `scripts/smoke.ts`, so the headless proof and the UI cannot
 * disagree about what an operation is.
 *
 * Nothing here prints and nothing here decides policy: LangSmith enforces governance
 * per user, and these functions surface its answers.
 */
import { fleetSkillBody } from "../skills/rules"
import { FleetClient, FleetError, withRetry } from "./core"

type Page<T> = { items?: T[]; next_cursor?: string | null }
type Obj = Record<string, unknown>

// ── identity & workspaces ───────────────────────────────────────────────────────
export type Workspace = { id: string; name: string }

/** Workspaces the CALLER belongs to (tenantless; server-filtered to the caller). */
export async function listWorkspaces(c: FleetClient, orgId?: string): Promise<Workspace[]> {
  let org = orgId
  if (!org) {
    const orgs = await c.get<Page<{ id: string }>>("/v1/fleet/orgs")
    org = orgs.items?.[0]?.id
  }
  if (!org) return []
  const res = await c.get<Page<{ id: string; name?: string; display_name?: string }>>(`/v1/fleet/orgs/${org}/tenants`)
  return (res.items ?? []).map((t) => ({ id: t.id, name: t.name || t.display_name || t.id }))
}

// ── catalogs ────────────────────────────────────────────────────────────────────
export type Catalog = {
  models: Obj[]
  integrations: Obj[]
  skills: Obj[]
  secrets: Obj[] | null
  snapshots: Obj[]
  policies: Obj[] | null
  /** Catalogs Fleet refused, keyed by name, with Fleet's one-line reason. */
  blocked: Record<string, string>
}

async function items(c: FleetClient, path: string, query?: Record<string, string | number>): Promise<Obj[]> {
  const res = await c.get<Page<Obj> | Obj[]>(path, query)
  return Array.isArray(res) ? res : (res.items ?? [])
}

/**
 * Everything a builder can build with — as LangSmith sees THIS caller. Each catalog is
 * fetched on its own: a 402/403/404 on one (a lapsed plan, a non-admin reading
 * `/secrets`, an older chart without sandboxes) becomes an entry in `blocked`, not a
 * dark portal. `integrations` is already ABAC-filtered and `can_invoke`-annotated by
 * Fleet for the caller.
 */
export async function discover(c: FleetClient): Promise<Catalog> {
  const blocked: Record<string, string> = {}
  const soft = async <T,>(key: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof FleetError && [401, 402, 403, 404, 405].includes(err.status)) {
        blocked[key] = err.detail
        return fallback
      }
      throw err
    }
  }
  const [models, integrations, skills, secrets, snapshots, policies] = await Promise.all([
    soft("models", () => items(c, "/v1/fleet/models"), []),
    soft("integrations", () => items(c, "/v1/fleet/integrations", { page_size: 100 }), []),
    // Every page: the rail's "Missing" badge is only true against the full list.
    soft("skills", () => listSkills(c), []),
    // Names + `set` only; Fleet never returns a value. Admin-only on some versions.
    soft<Obj[] | null>("secrets", () => items(c, "/v1/fleet/secrets"), null),
    soft("snapshots", () => items(c, "/v1/fleet/sandbox-snapshots"), []),
    // Access profiles live on the PLATFORM prefix, not /v1/fleet (sandboxpolicies/routes.go).
    soft<Obj[] | null>("policies", () => items(c, "/v1/platform/fleet/sandboxes/policies"), null),
  ])
  return { models, integrations, skills, secrets, snapshots, policies, blocked }
}

/**
 * Model to pre-select: Fleet's `is_default` → first workspace configuration → first.
 * Never throws for a missing name; ids differ across workspaces.
 */
export function defaultModel(models: Obj[]): Obj | null {
  return models.find((m) => m.is_default) ?? models.find((m) => m.source && m.source !== "built_in") ?? models[0] ?? null
}

/** Every secret the model needs is set. `null` secrets (not readable) = assume usable. */
export function modelReady(model: Obj, secrets: Obj[] | null): boolean | null {
  if (!secrets) return null
  const have = new Set(secrets.filter((s) => s.set).map((s) => s.name))
  return ((model.required_secrets as string[] | undefined) ?? []).every((n) => have.has(n))
}

export async function toolCatalog(c: FleetClient, integrationId: string): Promise<{ tools: Obj[]; listable: boolean; detail: string | null }> {
  // Integration endpoint only: it resolves the caller's OAuth server-side. The
  // arbitrary-URL /mcp/tools?url= form is deliberately not exposed (SSRF hygiene).
  try {
    const res = await c.get<Obj>(`/v1/fleet/integrations/${integrationId}/tools`)
    const tools = (res.items ?? res.tools ?? []) as Obj[]
    return { tools, listable: true, detail: null }
  } catch (err) {
    if (err instanceof FleetError && [400, 401, 403, 502].includes(err.status)) {
      return { tools: [], listable: false, detail: err.detail }
    }
    throw err
  }
}

// ── agents ──────────────────────────────────────────────────────────────────────
/** `user` = owned + directly shared; `tenant` = published to the workspace. */
export async function listAgents(c: FleetClient, audience: "user" | "tenant" = "user"): Promise<Obj[]> {
  const out: Obj[] = []
  let cursor: string | undefined
  for (let i = 0; i < 5; i++) {
    const page = await c.get<Page<Obj>>("/v1/fleet/agents", { audience, include: "owner", page_size: 100, cursor })
    out.push(...(page.items ?? []))
    cursor = page.next_cursor ?? undefined
    if (!cursor) break
  }
  return out
}

/** `files` is omitted unless asked for — without it, attached skills look missing. */
export function getAgent(c: FleetClient, id: string): Promise<Obj> {
  return c.get<Obj>(`/v1/fleet/agents/${id}`, { include: "files,owner" })
}

export type AgentSpec = {
  name: string
  description?: string
  model_id: string
  system_prompt?: string
  /** Immutable after create: `personal` = each user's own connections; `shared` = the agent's. */
  identity: "personal" | "shared"
  tools?: ToolEntry[]
  skills?: string[]
  subagents?: SubagentEntry[]
  backend?: BackendSpec
}
export type ToolEntry = { name: string; mcp_server_url: string; mcp_server_name?: string; display_name?: string; require_approval?: boolean }
export type SubagentEntry = { name: string; description?: string; system_prompt?: string; model_id?: string; tools?: ToolEntry[] }
export type BackendSpec =
  | { type: "state" }
  | { type: "sandbox"; scope: "thread" | "agent"; snapshot_id?: string; policy_ids?: string[] }

export function toolsBody(tools: ToolEntry[]) {
  const interrupt_config: Record<string, boolean> = {}
  for (const t of tools) if (t.require_approval) interrupt_config[t.name] = true
  return {
    tools: tools.map(({ require_approval: _r, ...rest }) => ({ ...rest, mcp_server_name: rest.mcp_server_name || undefined })),
    interrupt_config,
  }
}

export function skillPath(handle: string) {
  // A linked skill must be mounted at exactly `skills/<repo_handle>`.
  return `skills/${handle}`
}

export function backendBody(b: BackendSpec) {
  if (b.type === "state") return { type: "state" }
  const cfg: Obj = { scope: b.scope }
  if (b.snapshot_id) cfg.snapshot_id = b.snapshot_id
  if (b.policy_ids?.length) cfg.policy_ids = b.policy_ids
  return { type: "sandbox", sandbox_config: cfg }
}

/**
 * PATCH REPLACES the whole sandbox block: Fleet clears the sandbox id, snapshot, profiles
 * and TTLs before repopulating. So fields the editor does not show are carried forward:
 * the TTLs always, and the agent's own sandbox only while it stays the same machine
 * (agent scope before and after, same boot image). Dropping that id would orphan the
 * agent's computer and its files.
 */
export function mergeSandboxConfig(prev: Obj | null | undefined, next: Obj): Obj {
  if (!prev) return next
  const out: Obj = { ...next }
  for (const k of ["idle_ttl_seconds", "delete_after_stop_seconds"]) {
    if (out[k] == null && prev[k] != null) out[k] = prev[k]
  }
  const sameImage = !prev.snapshot_id || !next.snapshot_id || prev.snapshot_id === next.snapshot_id
  if (out.sandbox_id == null && prev.sandbox_id != null && prev.scope === "agent" && next.scope === "agent" && sameImage) {
    out.sandbox_id = prev.sandbox_id
  }
  return out
}

export function sandboxConfigOf(agent: Obj): Obj | null {
  const b = agent.backend as Obj | undefined
  return b?.type === "sandbox" ? ((b.sandbox_config as Obj | undefined) ?? {}) : null
}

function subagentBody(s: SubagentEntry) {
  return {
    name: s.name,
    description: s.description ?? "",
    system_prompt: s.system_prompt ?? "",
    ...(s.model_id ? { model: { id: s.model_id } } : {}),
    ...(s.tools?.length ? { tools: toolsBody(s.tools) } : {}),
  }
}

/**
 * One full-spec create, so a new agent is born complete instead of create-then-patch.
 * `visibility: user` is explicit because the server default is `tenant`.
 * `system_prompt` lands as AGENTS.md — guidance, not a guardrail; `interrupt_config` is
 * the enforcement point.
 */
export function createAgent(c: FleetClient, s: AgentSpec): Promise<Obj> {
  const files: Obj = {}
  for (const h of s.skills ?? []) files[skillPath(h)] = { type: "skill", repo_handle: h }
  return c.post<Obj>(
    "/v1/fleet/agents?include=owner",
    {
      name: s.name,
      description: s.description ?? "",
      model: { id: s.model_id },
      permissions: { identity: s.identity, visibility: "user" },
      ...(s.system_prompt ? { system_prompt: s.system_prompt } : {}),
      ...(s.tools?.length ? { tools: toolsBody(s.tools) } : {}),
      ...(s.subagents?.length ? { subagents: s.subagents.map(subagentBody) } : {}),
      ...(Object.keys(files).length ? { files } : {}),
      ...(s.backend ? { backend: backendBody(s.backend) } : {}),
    },
    "create agent",
  )
}

/** PATCH with retry: the runtime intermittently 502s a write that then succeeds. */
export function updateAgent(c: FleetClient, id: string, fields: Obj, note?: string): Promise<Obj> {
  return withRetry(() => c.patch<Obj>(`/v1/fleet/agents/${id}?include=files,owner`, fields, note), 3)
}

export const setInstructions = (c: FleetClient, id: string, text: string) => updateAgent(c, id, { system_prompt: text }, "set instructions")
export const setModel = (c: FleetClient, id: string, modelId: string) => updateAgent(c, id, { model: { id: modelId } }, "set model")
/** `tools` REPLACES tools.json wholesale — pass the complete set, not a delta. */
export const setTools = (c: FleetClient, id: string, tools: ToolEntry[]) => updateAgent(c, id, { tools: toolsBody(tools) }, "set tools")
export const attachSkill = (c: FleetClient, id: string, h: string) =>
  updateAgent(c, id, { files: { [skillPath(h)]: { type: "skill", repo_handle: h } } }, "attach skill")
export const detachSkill = (c: FleetClient, id: string, h: string) => updateAgent(c, id, { remove_file_paths: [skillPath(h)] }, "detach skill")
/** Reads the current computer first so the PATCH keeps what the editor doesn't show (see mergeSandboxConfig). */
export async function setBackend(c: FleetClient, id: string, b: BackendSpec): Promise<Obj> {
  const body = backendBody(b) as Obj
  if (b.type === "sandbox") {
    const prev = sandboxConfigOf(await c.get<Obj>(`/v1/fleet/agents/${id}`))
    body.sandbox_config = mergeSandboxConfig(prev, body.sandbox_config as Obj)
  }
  return updateAgent(c, id, { backend: body }, "set backend")
}
/** Upsert BY NAME — `subagents: [one]` does not drop the others. */
export const upsertSubagent = (c: FleetClient, id: string, s: SubagentEntry) => updateAgent(c, id, { subagents: [subagentBody(s)] }, "upsert subagent")
/** Removal needs BOTH files gone; the directory path alone does nothing. */
export const removeSubagent = (c: FleetClient, id: string, name: string) =>
  updateAgent(c, id, { remove_file_paths: [`subagents/${name}/AGENTS.md`, `subagents/${name}/tools.json`] }, "remove subagent")

export type Permissions = {
  visibility: "user" | "tenant"
  tenant_access_level: "read" | "run" | "write"
  shared_users: { read: string[]; run: string[]; write: string[] }
}

/**
 * Sharing. Owner-only — Fleet answers 403 to anyone else. Every bucket is sent, so the
 * result is exactly what the editor shows (buckets are tri-state on PATCH: sending one,
 * including `[]`, replaces it). `identity` is omitted: it is fixed at create.
 */
export const setPermissions = (c: FleetClient, id: string, p: Permissions) => updateAgent(c, id, { permissions: p }, "set permissions")

export const cloneAgent = (c: FleetClient, id: string, name: string) => c.post<Obj>(`/v1/fleet/agents/${id}/clone`, { name }, "clone agent")
export const archiveAgent = (c: FleetClient, id: string) => c.put<Obj>(`/v1/fleet/agents/${id}/archive`, undefined, "archive agent")
export const unarchiveAgent = (c: FleetClient, id: string) => c.del<Obj>(`/v1/fleet/agents/${id}/archive`, "unarchive agent")

export async function deleteAgent(c: FleetClient, id: string): Promise<void> {
  try {
    await c.del(`/v1/fleet/agents/${id}`, "delete agent")
  } catch (err) {
    if (!(err instanceof FleetError && err.status === 404)) throw err
  }
}

export async function searchUsers(c: FleetClient, search: string): Promise<Obj[]> {
  return items(c, "/v1/fleet/users", { search, page_size: 20 })
}

// ── workspace skills ────────────────────────────────────────────────────────────
/**
 * Skill bodies in the call log, Activity drawer and cURL: each file's content becomes its
 * size. A skill can hold anything a user pasted or uploaded, so its text never lands there.
 */
export function skillLogView(b: unknown): unknown {
  if (Array.isArray(b)) return b.map(skillLogView)
  if (!b || typeof b !== "object") return b
  const out: Obj = {}
  for (const [k, v] of Object.entries(b as Obj)) {
    if (k === "files" && v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = Object.fromEntries(
        Object.entries(v as Obj).map(([p, e]) => {
          const content = (e as Obj | null)?.content
          return [p, typeof content === "string" ? { ...(e as Obj), content: `<${new TextEncoder().encode(content).length} bytes>` } : e]
        }),
      )
    } else out[k] = k === "items" ? skillLogView(v) : v
  }
  return out
}

/** All workspace skills, every page (Fleet pages at 100). */
export async function listSkills(c: FleetClient): Promise<Obj[]> {
  const out: Obj[] = []
  let cursor: string | undefined
  for (let i = 0; i < 20; i++) {
    const page = await c.request<Page<Obj> | Obj[]>("GET", "/v1/fleet/skills", { query: { page_size: 100, cursor }, summarizeBody: skillLogView })
    if (Array.isArray(page)) return page
    out.push(...(page.items ?? []))
    cursor = page.next_cursor ?? undefined
    if (!cursor) break
  }
  return out
}

/** Creates a WORKSPACE skill: every member can read it, only its creator can change or delete it. */
export function createSkill(c: FleetClient, name: string, files: Record<string, string>): Promise<Obj> {
  return c.request<Obj>("POST", "/v1/fleet/skills", { body: fleetSkillBody(name, files), note: "create skill", summarizeBody: skillLogView })
}

/** Owner-only in LangSmith. Agents that link the skill keep a dangling link (see `skillUsage`). */
export const deleteSkill = (c: FleetClient, handle: string) => c.request("DELETE", `/v1/fleet/skills/${handle}`, { note: "delete skill" })

/** The caller as LangSmith knows them (tenantless). Unavailable to an API key in dev mode. */
export const currentFleetUser = (c: FleetClient) => c.get<Obj>("/v1/fleet/users/current")

const ID_FIELDS = ["id", "ls_user_id", "user_id", "email"]
const idsOf = (x: unknown): string[] =>
  (typeof x === "string" ? [x] : x && typeof x === "object" ? ID_FIELDS.map((k) => (x as Obj)[k]) : [])
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .map((v) => v.toLowerCase())

/**
 * Whether the caller is among a skill's `owners`. `null` = the portal cannot tell (no caller
 * identity, or owner entries it does not recognize); LangSmith decides on delete either way.
 */
export function isSkillOwner(owners: unknown, me: Obj | null): boolean | null {
  const mine = new Set(idsOf(me))
  if (!mine.size || !Array.isArray(owners) || !owners.length) return null
  const theirs = owners.flatMap(idsOf)
  if (!theirs.length) return null
  return theirs.some((id) => mine.has(id))
}

export async function listSkillsFor(c: FleetClient) {
  const [skills, me] = await Promise.all([listSkills(c), currentFleetUser(c).catch(() => null)])
  return {
    items: skills.map((s) => ({
      id: s.id as string,
      name: (s.name as string | undefined) ?? (s.id as string),
      description: (s.description as string | undefined) ?? "",
      file_count: s.files && typeof s.files === "object" ? Object.keys(s.files).length : null,
      updated_at: s.updated_at as string | undefined,
      mine: isSkillOwner(s.owners, me),
    })),
  }
}

/**
 * The agents THE CALLER CAN SEE that link a skill, and whether the caller can edit each.
 * Fleet has no reverse index, so this reads each agent's files: at most `cap` agents, five at
 * a time. Other agents in the workspace may link it too.
 */
export async function skillUsage(c: FleetClient, handle: string, cap = 50) {
  const [mine, published] = await Promise.all([listAgents(c, "user"), listAgents(c, "tenant")])
  const seen = new Set<string>()
  const all = [...mine, ...published].filter((a) => !seen.has(a.id as string) && seen.add(a.id as string))
  const checked = all.slice(0, cap)
  const linked: Obj[] = []
  for (let i = 0; i < checked.length; i += 5) {
    const batch = await Promise.all(
      checked.slice(i, i + 5).map((a) =>
        c
          .request<Obj>("GET", `/v1/fleet/agents/${a.id}`, { query: { include: "files,owner" }, note: "skill usage", summarizeBody: skillLogView })
          .catch(() => null),
      ),
    )
    for (const a of batch) if ((a?.files as Obj | undefined)?.[skillPath(handle)]) linked.push(a!)
  }
  return {
    agents: linked.map((a) => {
      const owner = a.owner as Obj | undefined
      return {
        id: a.id as string,
        name: a.name as string,
        owner: (owner?.name ?? owner?.email) as string | undefined,
        can_edit: a.is_owner === true || a.access_level === "write",
      }
    }),
    checked: checked.length,
    total: all.length,
  }
}

// ── threads ─────────────────────────────────────────────────────────────────────
/**
 * The CALLER's threads only — Fleet scopes this to `metadata.ls_user_id` server-side.
 * Page size is capped at 20 on this API; cursor for more.
 */
export function listThreads(c: FleetClient, opts: { agentId?: string; cursor?: string; testRun?: boolean } = {}) {
  return c.get<Page<Obj>>("/v1/fleet/threads", {
    agent_id: opts.agentId,
    cursor: opts.cursor,
    page_size: 20,
    include: "agent",
    test_run: opts.testRun ? true : undefined,
  })
}

export const threadCount = (c: FleetClient, agentId?: string) =>
  c.get<{ attention_count?: number }>("/v1/fleet/threads/count", { agent_id: agentId })

/**
 * A just-created agent 502s for a second or two ("upstream agent runtime returned an
 * unexpected response"). The response key is `id`, not `thread_id`.
 */
export async function createThread(c: FleetClient, agentId: string, testRun = false): Promise<string> {
  const res = await withRetry(() =>
    c.post<Obj>("/v1/fleet/threads", { agent_id: agentId, ...(testRun ? { options: { test_run: true } } : {}) }, testRun ? "create test thread" : "create thread"),
  )
  const id = (res.thread_id ?? res.id) as string | undefined
  if (!id) throw new Error("no thread id in create-thread response")
  return id
}

// ── messages & interrupts ───────────────────────────────────────────────────────
export type ToolCall = { name: string; arg: string | null }
export type Message = { type?: string; name?: string | null; text: string; tool_calls: ToolCall[] }

export type Interrupt = {
  id?: string
  /** approval = HITL tool review; auth_* = a tool needs an OAuth connection. */
  kind: "approval" | "auth_required" | "auth_unavailable" | "other"
  action_requests: Obj[]
  review_configs: Obj[]
  auth?: { provider?: string; tool?: string; auth_url?: string; message?: string; scopes?: string[] }
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .filter((b): b is Obj => !!b && typeof b === "object")
      .map((b) => String(b.text ?? ""))
      .join(" ")
      .trim()
  }
  return ""
}

const ARG_KEYS = ["file_path", "path", "filename", "query", "url", "name"]

/** `values` snapshots carry COMPLETE tool_calls (unlike streamed chunks). */
function toolCallsOf(m: Obj): ToolCall[] {
  const out: ToolCall[] = []
  for (const call of (m.tool_calls as Obj[] | undefined) ?? []) {
    if (!call?.name) continue
    const args = (call.args && typeof call.args === "object" ? call.args : {}) as Obj
    const key = ARG_KEYS.find((k) => typeof args[k] === "string" && args[k])
    out.push({ name: String(call.name), arg: key ? String(args[key]) : null })
  }
  return out
}

export function messagesOf(state: Obj): Message[] {
  return ((state.messages as Obj[] | undefined) ?? [])
    .filter((m) => m && typeof m === "object")
    .map((m) => ({ type: m.type as string, name: (m.name as string) ?? null, text: textOf(m.content), tool_calls: toolCallsOf(m) }))
}

function interruptOfValue(value: unknown, id?: string): Interrupt | null {
  let v = value
  if (Array.isArray(v)) v = v[0] // auth interrupts can arrive as an array
  if (!v || typeof v !== "object") return null
  const o = v as Obj
  if (o.type === "auth_required" || o.type === "auth_unavailable") {
    return {
      id,
      kind: o.type,
      action_requests: [],
      review_configs: [],
      auth: {
        provider: o.provider as string | undefined,
        tool: o.tool as string | undefined,
        auth_url: o.auth_url as string | undefined,
        message: o.message as string | undefined,
        scopes: o.scopes as string[] | undefined,
      },
    }
  }
  const action_requests = (o.action_requests as Obj[] | undefined) ?? []
  return {
    id,
    kind: action_requests.length ? "approval" : "other",
    action_requests,
    review_configs: (o.review_configs as Obj[] | undefined) ?? [],
  }
}

/**
 * Streaming shape: `values.__interrupt__` is an ARRAY of `{value, id}` — `id` is a
 * SIBLING of `value`.
 */
export function findInterrupt(values: unknown): Interrupt | null {
  const raw = values && typeof values === "object" ? (values as Obj).__interrupt__ : null
  if (!raw) return null
  const first = (Array.isArray(raw) ? raw[0] : raw) as Obj | undefined
  if (!first || typeof first !== "object") return null
  return interruptOfValue(first.value, first.id as string | undefined)
}

/** Thread GET shape: `interrupts` is an OBJECT keyed by id whose values are `[{value}]`. */
function interruptFromThread(thread: Obj, values: Obj): Interrupt | null {
  const found = findInterrupt(values)
  if (found) return found
  const raw = thread.interrupts
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [id, entries] of Object.entries(raw as Obj)) {
      for (const e of (Array.isArray(entries) ? entries : [entries]) as Obj[]) {
        const it = e && typeof e === "object" ? interruptOfValue(e.value, (e.id as string) ?? id) : null
        if (it) return it
      }
    }
  }
  return null
}

export type ThreadState = { status?: string; messages: Message[]; todos: Obj[]; interrupt: Interrupt | null; agent_id?: string }

/** Authoritative state — recovers after a dropped stream or a reload. */
export async function getThreadState(c: FleetClient, threadId: string): Promise<ThreadState> {
  const t = await c.get<Obj>(`/v1/fleet/threads/${threadId}`)
  const values = (t.values ?? {}) as Obj
  const meta = (t.metadata ?? {}) as Obj
  return {
    status: t.status as string | undefined,
    messages: messagesOf(values),
    todos: (values.todos as Obj[] | undefined) ?? [],
    interrupt: interruptFromThread(t, values),
    agent_id: (t.agent_id ?? meta.assistant_id) as string | undefined,
  }
}

// `values` resends whole state; `messages-tuple` adds token deltas. Use both.
const STREAM_MODE = ["values", "messages-tuple"]

export function sendMessage(c: FleetClient, threadId: string, agentId: string, text: string, overrides?: { model_id?: string }, signal?: AbortSignal) {
  return c.stream(
    `/v1/fleet/threads/${threadId}/runs/stream`,
    {
      agent_id: agentId,
      // Input messages use `type`, not `role`.
      input: { messages: [{ type: "human", content: text }] },
      stream_mode: STREAM_MODE,
      ...(overrides?.model_id ? { overrides: { model: { id: overrides.model_id } } } : {}),
    },
    "run: new turn",
    signal,
  )
}

export type Resume =
  | { kind: "approval"; decision: "approve" | "reject" | "respond" | "edit"; message?: string | null }
  | { kind: "auth"; action: "continue" | "skip" }

/**
 * `command.resume` on a NEW streamed run — NOT `resolve-interrupt`, which abandons the
 * pause. `resume` must be nested under `command`; spread at the top level it is silently
 * ignored and the run re-interrupts.
 */
export function resumeRun(c: FleetClient, threadId: string, agentId: string, r: Resume, signal?: AbortSignal) {
  const resume =
    r.kind === "approval"
      ? { decisions: [{ type: r.decision, ...(r.message ? { message: r.message } : {}) }] }
      : // AuthCheckMiddleware compares against {"type":"auth_required_response","action":"skip"}.
        { type: "auth_required_response", action: r.action }
  return c.stream(
    `/v1/fleet/threads/${threadId}/runs/stream`,
    { agent_id: agentId, command: { resume }, stream_mode: STREAM_MODE },
    r.kind === "approval" ? `run: resume (${r.decision})` : `run: resume auth (${r.action})`,
    signal,
  )
}

// ── OAuth connections ───────────────────────────────────────────────────────────
export type Token = { id: string; provider_slug: string; is_default?: boolean; expires_at?: string | null; scopes?: string[] | null }

export async function tokens(c: FleetClient): Promise<Token[]> {
  return (await items(c, "/v1/fleet/auth-tokens")) as unknown as Token[]
}

/**
 * Begin or refresh an authorization. `REUSE` refreshes an existing token in place and
 * returns `completed` with no `verification_url`; only when there is nothing to reuse
 * does it return a consent URL. `scopes` must be present (`[]` is fine).
 */
export function startConnection(c: FleetClient, providerSlug: string, scopes: string[] = []) {
  return c.post<Obj>(
    "/v1/fleet/auth-sessions",
    { provider_slug: providerSlug, scopes, strategy: "REUSE", is_default: true },
    `connect ${providerSlug}`,
  )
}

export const pollConnection = (c: FleetClient, sessionId: string, waitSeconds = 25) =>
  c.get<Obj>(`/v1/fleet/auth-sessions/${sessionId}`, { wait_seconds: waitSeconds })

const OK = ["success", "complete", "completed", "authorized", "active", "done", "ready", "granted"]
const BAD = ["fail", "error", "denied", "revoked", "cancel", "reject", "invalid"]
export function classifyConnection(status: unknown): "connected" | "pending" | "expired" | "failed" {
  const t = String(status ?? "").toLowerCase()
  if (OK.some((w) => t.includes(w))) return "connected"
  if (t.includes("expire") || t.includes("timeout") || t.includes("timed_out")) return "expired"
  if (BAD.some((w) => t.includes(w))) return "failed"
  return "pending"
}

/** Connections bound to the AGENT. Only meaningful for `identity=shared` agents. */
export const agentConnections = async (c: FleetClient, agentId: string) =>
  (await items(c, `/v1/fleet/agents/${agentId}/connections`)) as unknown as { id: string; auth_token_id?: string; provider_slug?: string }[]

/**
 * Bind the caller's token for `providerSlug` to a SHARED-identity agent and read it
 * back. Personal agents need no binding — each caller's own token is resolved at run
 * time — so this is never called for them. Owner/write only.
 */
export async function bindForSharedAgent(c: FleetClient, agentId: string, providerSlug: string): Promise<boolean> {
  const mine = (await tokens(c)).filter((t) => t.provider_slug === providerSlug)
  if (!mine.length) return false
  const ids = new Set(mine.map((t) => t.id))
  const bound = await agentConnections(c, agentId)
  if (bound.some((b) => b.auth_token_id && ids.has(b.auth_token_id))) return true
  const token = mine.find((t) => t.is_default) ?? mine[0]
  await c.post(`/v1/fleet/agents/${agentId}/connections`, { auth_token_id: token.id }, "bind connection")
  const after = await agentConnections(c, agentId)
  return after.some((b) => b.auth_token_id && ids.has(b.auth_token_id))
}

// ── sandboxes (Computer) ────────────────────────────────────────────────────────
export const sandboxFiles = (c: FleetClient, slug: string, path?: string) =>
  c.get<Obj>(`/v1/fleet/sandboxes/${slug}/files`, { path })
export const sandboxFileContent = (c: FleetClient, slug: string, path: string) =>
  c.raw(`/v1/fleet/sandboxes/${slug}/files/content`, { path })
