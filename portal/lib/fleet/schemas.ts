import { z } from "zod"

/** Request bodies the portal accepts. Typed end to end — no raw passthrough to Fleet. */

const slug = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)

export const Tool = z.object({
  name: z.string().min(1).max(200),
  mcp_server_url: z.string().url().max(500),
  mcp_server_name: z.string().max(200).optional(),
  display_name: z.string().max(200).optional(),
  require_approval: z.boolean().optional(),
})

export const Subagent = z.object({
  name: slug,
  description: z.string().max(2000).optional(),
  system_prompt: z.string().max(20000).optional(),
  model_id: z.string().max(200).optional(),
  tools: z.array(Tool).max(100).optional(),
})

export const Backend = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state") }),
  z.object({
    type: z.literal("sandbox"),
    scope: z.enum(["thread", "agent"]),
    snapshot_id: z.string().max(200).optional(),
    policy_ids: z.array(z.string().max(200)).max(50).optional(),
  }),
])

export const CreateAgent = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  model_id: z.string().min(1).max(200),
  system_prompt: z.string().max(20000).optional(),
  identity: z.enum(["personal", "shared"]),
  tools: z.array(Tool).max(100).optional(),
  skills: z.array(slug).max(50).optional(),
  subagents: z.array(Subagent).max(20).optional(),
  backend: Backend.optional(),
})

export const PatchAgent = z.discriminatedUnion("op", [
  z.object({ op: z.literal("meta"), name: z.string().min(1).max(120), description: z.string().max(2000) }),
  z.object({ op: z.literal("instructions"), system_prompt: z.string().max(20000) }),
  z.object({ op: z.literal("model"), model_id: z.string().min(1).max(200) }),
  z.object({ op: z.literal("tools"), tools: z.array(Tool).max(100) }),
  z.object({ op: z.literal("backend"), backend: Backend }),
])

export const Permissions = z.object({
  visibility: z.enum(["user", "tenant"]),
  tenant_access_level: z.enum(["read", "run", "write"]),
  shared_users: z.object({
    read: z.array(z.string().uuid()).max(500),
    run: z.array(z.string().uuid()).max(500),
    write: z.array(z.string().uuid()).max(500),
  }),
})

export const SendMessage = z.object({ agent_id: z.string().uuid(), text: z.string().min(1).max(8000) })

export const ResumeBody = z.discriminatedUnion("kind", [
  z.object({
    agent_id: z.string().uuid(),
    kind: z.literal("approval"),
    decision: z.enum(["approve", "reject", "respond"]),
    message: z.string().max(8000).nullish(),
  }),
  z.object({ agent_id: z.string().uuid(), kind: z.literal("auth"), action: z.enum(["continue", "skip"]) }),
])

export const Connect = z.object({ provider_slug: slug, scopes: z.array(z.string().max(500)).max(50).default([]) })
