import { defaultModel, discover, modelReady } from "@/lib/fleet/ops"
import { actsAsUser, isGraphProfile, limitsEgress } from "@/lib/fleet/computer-access"
import { route } from "@/lib/fleet/server"

/**
 * What THIS user can build with, as LangSmith sees them. Nothing is filtered here: the
 * integrations list is already ABAC-filtered per caller by Fleet (with `can_invoke`),
 * and the models list reflects what the workspace enabled for Fleet.
 */
export const GET = route({}, async ({ fleet }) => {
  const cat = await discover(fleet)
  const models = cat.models.map((m) => ({
    id: m.id,
    display_name: m.display_name,
    source: m.source,
    provider: m.provider,
    is_default: m.is_default,
    required_secrets: m.required_secrets ?? [],
    ready: modelReady(m, cat.secrets),
  }))
  const integrations = cat.integrations.map((i) => ({
    id: i.id,
    name: i.name,
    url: i.url,
    source: i.source,
    can_invoke: i.can_invoke !== false,
    auth_methods: ((i.auth_methods as unknown[]) ?? []).filter(Boolean),
  }))
  return {
    models,
    default_model_id: (defaultModel(cat.models)?.id as string | undefined) ?? null,
    integrations,
    skills: cat.skills.map((s) => ({ id: s.id, name: s.name ?? s.id, description: s.description ?? "" })),
    snapshots: cat.snapshots.map((s) => ({ id: s.id, name: s.name ?? s.id, status: s.status })),
    // Flags only — the browser never gets the profile config.
    policies: cat.policies?.map((p) => ({ id: p.id, name: p.name ?? p.id, graph: isGraphProfile(p), acts_as_user: actsAsUser(p), limits_egress: limitsEgress(p) })) ?? null,
    blocked: cat.blocked,
  }
})
