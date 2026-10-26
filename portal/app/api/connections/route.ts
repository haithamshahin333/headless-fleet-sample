import { tokens } from "@/lib/fleet/ops"
import { route } from "@/lib/fleet/server"

/** YOUR OAuth connections (provider + expiry). Never a token value. */
export const GET = route({}, async ({ fleet }) => ({
  items: (await tokens(fleet)).map((t) => ({ id: t.id, provider_slug: t.provider_slug, is_default: t.is_default, expires_at: t.expires_at })),
}))
