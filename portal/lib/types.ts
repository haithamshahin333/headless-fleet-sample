/** Browser-side shapes. Server-side, the same data comes from lib/fleet/ops.ts. */

export type SandboxConfig = {
  scope?: "thread" | "agent" | string
  sandbox_id?: string
  sandbox_slug?: string
  status?: string
  policy_ids?: string[]
  snapshot_id?: string
  idle_ttl_seconds?: number
}

export type AccessLevel = "read" | "run" | "write"

export type Permissions = {
  identity?: "personal" | "shared"
  visibility?: "user" | "tenant"
  tenant_access_level?: AccessLevel
  shared_users?: { read?: string[]; run?: string[]; write?: string[]; update?: string[] }
}

export type Agent = {
  id: string
  name: string
  description?: string
  owner_id?: string
  owner?: { id: string; name?: string; email?: string }
  is_owner?: boolean
  /** Fleet's caller-relative level: what YOU may do with this agent. */
  access_level?: AccessLevel
  is_archived?: boolean
  revision?: string
  system_prompt?: string
  permissions?: Permissions
  model?: { id?: string }
  backend?: { type?: "state" | "sandbox" | string; sandbox_config?: SandboxConfig }
  tools?: { tools?: ToolSpec[]; interrupt_config?: Record<string, unknown> }
  subagents?: Subagent[]
  /** Only present when fetched with `?include=files`. */
  files?: Record<string, { type?: string; repo_handle?: string; content?: string }>
  updated_at?: string
}

export type ToolSpec = { name: string; mcp_server_url?: string; mcp_server_name?: string; display_name?: string }

export type Snapshot = { id: string; name?: string; status?: string }
/**
 * Computed server-side. `graph`: a credential rule for graph.microsoft.com from the org's
 * Microsoft connection. `acts_as_user`: injects the running user's own token (any provider),
 * so it needs a per-conversation computer. `limits_egress`: has an allow or deny host list.
 */
export type SandboxPolicy = { id: string; name?: string; graph?: boolean; acts_as_user?: boolean; limits_egress?: boolean }
export type AuthMethod = { type?: string; provider_match?: { by?: string; value?: string }; scopes?: string[] }
export type Integration = {
  id: string
  name?: string
  url?: string
  source?: string
  /** Fleet's per-caller verdict: false = your role/ABAC policy does not allow invoking it. */
  can_invoke?: boolean
  auth_methods?: AuthMethod[]
}
export type Connection = { id?: string; provider_slug?: string; is_default?: boolean; expires_at?: string | null }
export type ConnectStart = {
  state: "connected" | "pending" | "expired" | "failed"
  session_id?: string | null
  verification_url?: string | null
  provider_slug?: string
}
export type CatalogTool = { name: string; description?: string }
/** `connected` here means LISTABLE, not authorized. Authorization is `getConnections()`. */
export type ToolCatalog = { tools: CatalogTool[]; connected: boolean; detail?: string | null }
export type Subagent = {
  name: string
  description?: string
  system_prompt?: string
  model?: { id?: string }
  tools?: { tools?: ToolSpec[]; interrupt_config?: Record<string, unknown> }
}

export type Model = {
  id: string
  display_name?: string
  source?: string
  provider?: string
  is_default?: boolean
  required_secrets?: string[]
  /** null = secrets not readable by you; assume usable. */
  ready?: boolean | null
}

export type Skill = { id: string; name?: string; description?: string }
/** GET /api/skills. `mine`: null = the portal can't tell who owns it; LangSmith decides on delete. */
export type WorkspaceSkill = Skill & { file_count?: number | null; updated_at?: string; mine: boolean | null }
export type SkillUsage = { agents: { id: string; name: string; owner?: string; can_edit: boolean }[]; checked: number; total: number }
/** POST /api/skills. A failed link keeps the skill: `attached` false with `attach_error`. */
export type CreatedSkill = { skill: Skill; attached: boolean; agent: Agent | null; attach_error: string | null }

/** GET /api/catalog — what LangSmith lets THIS user build with in this workspace. */
export type Catalog = {
  models: Model[]
  default_model_id: string | null
  integrations: Integration[]
  skills: Skill[]
  snapshots: Snapshot[]
  /** null = access profiles not readable with your identity. */
  policies: SandboxPolicy[] | null
  blocked: Record<string, string>
}
/** The rail sections were written against `Context`; the catalog is a superset. */
export type Context = Catalog

export type Workspace = { id: string; name: string }
export type Me = {
  name: string
  email: string
  roles: string[]
  can_build: boolean
  /** False when no builder roles are configured: Build is off for everyone. */
  build_enabled: boolean
  is_admin: boolean
  dev: boolean
  workspaces: Workspace[]
  current_workspace: Workspace | null
  langsmith_ui: string | null
}

export type ThreadSummary = {
  id: string
  agent_id?: string
  agent?: { id: string; name?: string }
  title?: string | null
  last_message?: string | { content?: string } | null
  status?: "idle" | "busy" | "interrupted" | "error"
  has_interrupts?: boolean
  updated_at?: string
  state_updated_at?: string
  created_at?: string
}
export type ThreadPage = { items: ThreadSummary[]; next_cursor?: string | null; attention_count?: number | null }

export type ToolCall = { name: string; arg?: string | null }
export type Message = { type?: string; name?: string | null; text?: string; tool_calls?: ToolCall[] }

export type ActionRequest = { name?: string; args?: Record<string, unknown>; description?: string }
export type ReviewConfig = { action_name?: string; allowed_decisions?: string[] }

export type Interrupt = {
  id?: string
  kind: "approval" | "auth_required" | "auth_unavailable" | "other"
  action_requests: ActionRequest[]
  review_configs: ReviewConfig[]
  auth?: { provider?: string; tool?: string; auth_url?: string; message?: string; scopes?: string[] }
}

export type Todo = { content: string; status?: "pending" | "in_progress" | "completed" }

export type StreamState = {
  messages: Message[]
  todos: Todo[]
  interrupt: Interrupt | null
  recovered?: boolean
  thread_status?: string
}

export type ProviderStatus = "connected" | "missing" | "owner_must_connect" | "managed_by_owner"
export type RequiredProvider = {
  slug: string
  integrations: string[]
  tools: string[]
  scopes: string[]
  status: ProviderStatus
  expires_at?: string | null
  refreshed?: boolean
}
export type Readiness = {
  identity: "personal" | "shared"
  can_bind: boolean
  providers: RequiredProvider[]
  ready: boolean
  warning?: string
  /** Microsoft Graph access for the agent's computer (access profile + the caller's connection). */
  computer?: ComputerAccess | null
}

export type ComputerAccess = {
  applicable: boolean
  shared_computer: boolean
  provider: string
  scopes: string[]
  attached: { id: string; name: string } | null
  mine: { id: string; name: string } | null
  mine_limits_egress: boolean
  can_edit: boolean
  connection: "connected" | "missing" | "unknown"
  warning?: string
}

export type User = { id: string; name?: string; email?: string }

export type ApiCall = {
  at: string
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
export type Activity = { base_url: string; auth_mode: string; items: ApiCall[] }

/** What a route handler sends back when LangSmith (or the portal) says no. */
export type ApiErrorBody = { detail?: string; hint?: string; enforced_by?: "langsmith" | "portal"; code?: string }
