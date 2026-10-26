/**
 * Headless proof — no browser, no portal. Shares lib/fleet/{core,ops,readiness} with the
 * route handlers, so this and the UI cannot disagree about what an operation is.
 *
 *   npx tsx --env-file=.env.local scripts/smoke.ts                 # per-user views + capabilities
 *   npx tsx --env-file=.env.local scripts/smoke.ts --lifecycle     # create → run → approve → share → clean up
 *   npx tsx --env-file=.env.local scripts/smoke.ts --auth-probe    # capture a live auth-interrupt frame
 *   npx tsx --env-file=.env.local scripts/smoke.ts --computer      # sandbox ("Computer") readiness
 *
 * Identity, from env:
 *   - OIDC bearer (self-hosted): SMOKE_BEARER = one user's access token for LangSmith (the
 *     same token the portal sends), or labelled tokens "avery=<token>,jordan=<token>" to
 *     compare users
 *   - Dev fallback: LANGSMITH_API_KEY (one user — governance differences cannot show)
 * Plus LANGSMITH_API_URL (default https://api.smith.langchain.com) and optionally
 * LANGSMITH_ORG_ID / LANGSMITH_WORKSPACE_ID.
 *
 * The tokens act as those users until they expire (about an hour). Never print or commit them.
 */
import { FleetClient, FleetError, activityFor, type FleetIdentity } from "../lib/fleet/core"
import * as ops from "../lib/fleet/ops"
import { requiredProviders } from "../lib/fleet/readiness"

type Obj = Record<string, unknown>
const args = new Set(process.argv.slice(2))
const base = (process.env.LANGSMITH_API_URL ?? "https://api.smith.langchain.com").replace(/\/+$/, "")
const bearer = (process.env.SMOKE_BEARER ?? "").trim()
const fallbackWs = process.env.LANGSMITH_WORKSPACE_ID

type Who = { label: string; identity: FleetIdentity }
function users(): Who[] {
  if (bearer) {
    // A JWT has no "=" or ",", so "label=token" pairs parse safely.
    return bearer.split(",").map((s, i) => {
      const [label, token] = s.includes("=") ? s.trim().split("=", 2) : [`user${i + 1}`, s.trim()]
      return { label, identity: { mode: "bearer", token } }
    })
  }
  if (!process.env.LANGSMITH_API_KEY) throw new Error("set SMOKE_BEARER (access token[s] LangSmith accepts) or LANGSMITH_API_KEY")
  return [{ label: "dev", identity: { mode: "api-key", apiKey: process.env.LANGSMITH_API_KEY } }]
}

const ok = (b: boolean) => (b ? "✓" : "✗")
const short = (e: unknown) => (e instanceof FleetError ? `${e.status} ${e.detail.slice(0, 90)}` : String(e).slice(0, 120))

async function clientFor(w: Who): Promise<{ c: FleetClient; workspaces: ops.Workspace[] }> {
  const root = new FleetClient({ baseUrl: base, identity: w.identity, logAs: w.label })
  let workspaces: ops.Workspace[] = []
  try {
    workspaces = await ops.listWorkspaces(root, process.env.LANGSMITH_ORG_ID)
  } catch (e) {
    console.log(`  [${w.label}] tenantless workspace listing unavailable: ${short(e)}`)
  }
  const ws = workspaces.find((x) => x.id === fallbackWs) ?? workspaces[0] ?? (fallbackWs ? { id: fallbackWs, name: "(config)" } : undefined)
  if (!ws) throw new Error(`no workspace for ${w.label}`)
  return { c: root.withTenant(ws.id), workspaces }
}

async function views(list: Who[]) {
  console.log(`\n== Per-user views (${bearer ? "OIDC bearer" : "DEV: one shared API key"}) @ ${base}`)
  const rows: string[][] = [["user", "workspaces", "models", "integrations (denied)", "skills", "agents mine/published", "threads", "attention"]]
  for (const w of list) {
    try {
      const { c, workspaces } = await clientFor(w)
      const cat = await ops.discover(c)
      const denied = cat.integrations.filter((i) => i.can_invoke === false).map((i) => i.name)
      const [mine, pub, th, cnt] = await Promise.all([
        ops.listAgents(c, "user"),
        ops.listAgents(c, "tenant"),
        ops.listThreads(c),
        ops.threadCount(c).catch(() => ({ attention_count: undefined })),
      ])
      rows.push([
        w.label,
        String(workspaces.length || "config"),
        String(cat.models.length),
        `${cat.integrations.length} (${denied.length ? denied.join(", ") : "none"})`,
        String(cat.skills.length),
        `${mine.length}/${pub.length}`,
        String(th.items?.length ?? 0) + (th.next_cursor ? "+" : ""),
        String(cnt.attention_count ?? "?"),
      ])
      if (Object.keys(cat.blocked).length) console.log(`  [${w.label}] refused catalogs:`, cat.blocked)
    } catch (e) {
      rows.push([w.label, `ERROR ${short(e)}`])
    }
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)))
  for (const r of rows) console.log("  " + r.map((v, i) => (v ?? "").padEnd(widths[i])).join("  "))
}

async function capabilities(w: Who) {
  console.log(`\n== Capabilities on this install (as ${w.label})`)
  const { c } = await clientFor(w)
  const probe = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn()
      console.log(`  ${ok(true)} ${label}`)
    } catch (e) {
      console.log(`  ${ok(false)} ${label} — ${short(e)}`)
    }
  }
  await probe("GET /v1/fleet/orgs (tenantless)", () => c.get("/v1/fleet/orgs"))
  await probe("GET /v1/fleet/users/current (tenantless)", () => c.get("/v1/fleet/users/current"))
  await probe("GET /v1/fleet/threads (caller-scoped)", () => ops.listThreads(c))
  await probe("GET /v1/fleet/agents?audience=tenant", () => ops.listAgents(c, "tenant"))
  await probe("GET /v1/fleet/sandbox-snapshots", () => c.get("/v1/fleet/sandbox-snapshots"))
  await probe("GET /v1/platform/fleet/sandboxes/policies (platform plane)", () => c.get("/v1/platform/fleet/sandboxes/policies"))
  await probe("GET /v1/fleet/secrets (admin-only on some versions)", () => c.get("/v1/fleet/secrets"))
  if (w.identity.mode === "bearer") {
    // Same issuer and claims, broken signature: Fleet must refuse it (401, no fall-through).
    const t = w.identity.token
    const tampered = t.slice(0, -2) + (t.endsWith("AA") ? "BB" : "AA")
    for (const [what, token] of [["a tampered token", tampered], ["no token", ""]] as const) {
      const bad = new FleetClient({ baseUrl: base, identity: { mode: "bearer", token }, tenantId: c.tenantId, logAs: "neg" })
      try {
        await bad.get("/v1/fleet/models")
        console.log(`  ${ok(false)} ${what} was ACCEPTED — check FLEET_EXTERNAL_AUTH_OIDC_* on platform-backend!`)
      } catch (e) {
        console.log(`  ${ok(e instanceof FleetError && e.status === 401)} ${what} rejected (${short(e)})`)
      }
    }
  }
}

const DOCS = { name: "search_docs_by_lang_chain", mcp_server_url: "https://docs.langchain.com/mcp", mcp_server_name: "langchain-docs-mcp" }

async function drain(gen: AsyncGenerator<{ event: string; data: unknown }>) {
  let interrupt: ops.Interrupt | null = null
  let last: ops.Message[] = []
  for await (const f of gen) {
    const d = f.data as Obj
    if (!f.event.startsWith("messages") && d && typeof d === "object" && !Array.isArray(d)) {
      if (Array.isArray(d.messages)) last = ops.messagesOf(d)
      if (Array.isArray(d.messages) || "__interrupt__" in d) interrupt = ops.findInterrupt(d)
    }
  }
  return { interrupt, last }
}

async function lifecycle(list: Who[]) {
  const owner = list[0]
  console.log(`\n== Lifecycle as ${owner.label}`)
  const { c } = await clientFor(owner)
  const cat = await ops.discover(c)
  const model = ops.defaultModel(cat.models)
  if (!model) throw new Error("no models in workspace")
  const agent = await ops.createAgent(c, {
    name: `smoke-${Date.now()}`,
    description: "throwaway agent from scripts/smoke.ts",
    model_id: String(model.id),
    identity: "personal",
    system_prompt: "Answer briefly. Use the docs search tool once before answering.",
    tools: [{ ...DOCS, require_approval: true }],
  })
  const id = String(agent.id)
  console.log(`  ${ok(true)} created ${id} (model ${model.display_name})`)
  const cleanup: string[] = [id]
  try {
    const tid = await ops.createThread(c, id)
    console.log(`  ${ok(true)} thread ${tid}`)
    let r = await drain(ops.sendMessage(c, tid, id, "What is LangGraph? One sentence."))
    console.log(`  ${ok(r.interrupt?.kind === "approval")} interrupt raised: ${r.interrupt?.kind ?? "none"}`)
    for (let i = 0; i < 4 && r.interrupt?.kind === "approval"; i++) {
      r = await drain(ops.resumeRun(c, tid, id, { kind: "approval", decision: "approve" }))
    }
    const answer = [...r.last].reverse().find((m) => m.type === "ai" && m.text)?.text ?? ""
    console.log(`  ${ok(!!answer)} answer: ${answer.slice(0, 100).replace(/\s+/g, " ")}`)
    const mine = await ops.listThreads(c, { agentId: id })
    console.log(`  ${ok((mine.items ?? []).some((t) => t.id === tid))} thread appears in caller's history`)

    const clone = await ops.cloneAgent(c, id, "smoke clone")
    cleanup.push(String(clone.id))
    console.log(`  ${ok(true)} cloned → ${clone.id}`)

    const others = list.slice(1)
    const runUsers: string[] = []
    for (const o of others) {
      const { c: oc } = await clientFor(o)
      const me = await oc.get<Obj>("/v1/fleet/users/current").catch(() => null)
      if (me?.id) runUsers.push(String(me.id))
    }
    await ops.setPermissions(c, id, { visibility: "user", tenant_access_level: "read", shared_users: { read: [], run: runUsers, write: [] } })
    console.log(`  ${ok(true)} shared at Run with ${runUsers.length} user(s)`)
    for (const o of others) {
      const { c: oc } = await clientFor(o)
      const seen = (await ops.listAgents(oc, "user")).find((a) => a.id === id)
      console.log(`  ${ok(seen?.access_level === "run")} ${o.label} sees it with access_level=${seen?.access_level ?? "none"}`)
      const theirs = await ops.listThreads(oc, { agentId: id }).catch(() => ({ items: [] }))
      console.log(`  ${ok(!(theirs.items ?? []).some((t) => t.id === tid))} ${o.label} cannot see ${owner.label}'s thread`)
    }
    try {
      await ops.archiveAgent(c, id)
      await ops.unarchiveAgent(c, id)
      console.log(`  ${ok(true)} archive / unarchive`)
    } catch (e) {
      console.log(`  ${ok(false)} archive / unarchive — ${short(e)}`)
    }
  } finally {
    for (const a of cleanup) await ops.deleteAgent(c, a).catch(() => undefined)
    console.log(`  ${ok(true)} cleaned up ${cleanup.length} agent(s)`)
  }
}

/** Create an agent whose tool needs an OAuth provider the caller has NOT connected. */
async function authProbe(list: Who[]) {
  const owner = list[0]
  console.log(`\n== Auth-interrupt probe as ${owner.label}`)
  const { c } = await clientFor(owner)
  const cat = await ops.discover(c)
  const have = new Set((await ops.tokens(c)).map((t) => t.provider_slug))
  let pick: { integ: Obj; tool: Obj } | null = null
  for (const integ of cat.integrations) {
    const fake = { tools: { tools: [{ name: "x", mcp_server_url: integ.url, mcp_server_name: integ.name }] } }
    const need = requiredProviders(fake, [integ])
    if (!need.length || have.has(need[0].slug) || integ.can_invoke === false) continue
    const tc = await ops.toolCatalog(c, String(integ.id))
    const tool = tc.tools.find((t) => /list|search|get/i.test(String(t.name)))
    if (tool) {
      pick = { integ, tool }
      break
    }
  }
  if (!pick) return console.log("  (skipped) every OAuth integration is already connected for this user")
  const model = ops.defaultModel(cat.models)!
  const agent = await ops.createAgent(c, {
    name: `smoke-auth-${Date.now()}`,
    model_id: String(model.id),
    identity: "personal",
    system_prompt: `Immediately call the ${pick.tool.name} tool once with minimal arguments, then summarize.`,
    tools: [{ name: String(pick.tool.name), mcp_server_url: String(pick.integ.url), mcp_server_name: String(pick.integ.name) }],
  })
  try {
    const tid = await ops.createThread(c, String(agent.id))
    const raw: unknown[] = []
    let interrupt: ops.Interrupt | null = null
    for await (const f of ops.sendMessage(c, tid, String(agent.id), "Go.")) {
      const d = f.data as Obj
      if (d && typeof d === "object" && !Array.isArray(d) && "__interrupt__" in d) {
        raw.push(d.__interrupt__)
        interrupt = ops.findInterrupt(d)
      }
    }
    console.log(`  integration ${pick.integ.name}, tool ${pick.tool.name}`)
    console.log(`  ${ok(!!interrupt && interrupt.kind.startsWith("auth"))} interrupt kind: ${interrupt?.kind ?? "none"}`)
    console.log("  raw __interrupt__ (auth_url elided):", JSON.stringify(raw.at(-1), (k, v) => (k === "auth_url" && v ? "<url>" : v)).slice(0, 600))
    if (interrupt?.kind.startsWith("auth")) {
      const r = await drain(ops.resumeRun(c, tid, String(agent.id), { kind: "auth", action: "skip" }))
      console.log(`  ${ok(!r.interrupt)} resumed with skip → ${r.interrupt ? "still interrupted" : "run settled"}`)
    }
  } finally {
    await ops.deleteAgent(c, String(agent.id))
  }
}

async function computer(list: Who[]) {
  const w = list[0]
  console.log(`\n== Computer (sandbox) readiness as ${w.label}`)
  const { c } = await clientFor(w)
  const snaps = await c.get<{ items?: Obj[] }>("/v1/fleet/sandbox-snapshots").catch((e) => (console.log(`  ✗ snapshots — ${short(e)}`), null))
  if (!snaps) return
  console.log(`  ✓ ${snaps.items?.length ?? 0} snapshot(s)`)
  const snap = snaps.items?.[0]
  if (!snap) return console.log("  (skipped) no snapshot to boot")
  const cat = await ops.discover(c)
  const agent = await ops.createAgent(c, {
    name: `smoke-computer-${Date.now()}`,
    model_id: String(ops.defaultModel(cat.models)!.id),
    identity: "personal",
    system_prompt: "You have a computer. Run shell commands when asked.",
    backend: { type: "sandbox", scope: "agent", snapshot_id: String(snap.id) },
  })
  try {
    const sc = ((agent.backend as Obj | undefined)?.sandbox_config ?? {}) as Obj
    console.log(`  ✓ agent-scoped computer provisioned: slug=${sc.sandbox_slug ?? "?"} status=${sc.status ?? "?"}`)
    const tid = await ops.createThread(c, String(agent.id))
    const r = await drain(ops.sendMessage(c, tid, String(agent.id), "Write hello.txt containing 'hi' in the working directory, then run `ls -la` and tell me the output."))
    console.log(`  ${ok(r.last.some((m) => m.tool_calls.length))} agent used tools: ${[...new Set(r.last.flatMap((m) => m.tool_calls.map((t) => t.name)))].join(", ")}`)
    if (sc.sandbox_slug) {
      const files = await ops.sandboxFiles(c, String(sc.sandbox_slug)).catch((e) => ({ error: short(e) }))
      console.log("  files:", JSON.stringify(files).slice(0, 300))
    }
  } finally {
    await ops.deleteAgent(c, String(agent.id))
  }
}

async function main() {
  const list = users()
  await views(list)
  await capabilities(list[0])
  if (args.has("--lifecycle")) await lifecycle(list)
  if (args.has("--auth-probe")) await authProbe(list)
  if (args.has("--computer")) await computer(list)
  const n = list.reduce((s, w) => s + activityFor(w.label).length, 0)
  console.log(`\n${n} Fleet calls made (redacted call log kept in memory).`)
}

main().catch((e) => {
  console.error("smoke failed:", short(e))
  process.exit(1)
})
