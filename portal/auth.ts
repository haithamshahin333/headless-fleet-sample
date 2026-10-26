import NextAuth, { type NextAuthConfig } from "next-auth"
import Credentials from "next-auth/providers/credentials"

import { config, DEV_LOGIN, DEV_ROLES, oidcScope } from "@/lib/config"
import { accessTokenProblem, claimAt, type FleetTokens, fresh, refreshFleetToken } from "@/lib/fleet/token"

export { DEV_LOGIN }

/**
 * Sign-in for the portal.
 *
 * Production: any OpenID Connect provider (Entra ID, Keycloak, Okta, Auth0, …), issuer
 * pinned. Sign-in also asks for whatever makes the provider issue an access token LangSmith
 * accepts (`OIDC_API_SCOPE`, `OIDC_AUDIENCE_PARAM`). The encrypted JWT cookie holds the
 * user's id (the subject claim LangSmith maps), name, email, roles and the access + refresh
 * tokens. The route handlers send that access token to Fleet as `Authorization: Bearer`;
 * LangSmith checks it and maps its subject claim to the user. The session object (what
 * `/api/auth/session` returns to the browser) never carries a token. The jwt callback
 * refreshes the token shortly before it expires; if that fails, the user signs in again.
 *
 * Development (`PORTAL_DEV_LOGIN=1`, refused in production): pick a persona with no IdP.
 * Every persona then shares one LangSmith credential, so LangSmith sees ONE user — the
 * portal says so on screen. Use it to work on the UI, not to demo governance.
 */

declare module "next-auth" {
  interface Session {
    /** `reauth`: no usable Fleet token (refresh failed, or a cookie from before the API scope). */
    user: { name?: string | null; email?: string | null; uid: string; roles: string[]; dev?: boolean; reauth?: boolean }
  }
}
declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string
    roles?: string[]
    dev?: boolean
    fleet?: FleetTokens
    error?: "refresh_failed"
  }
}

if (DEV_LOGIN && process.env.NODE_ENV === "production") {
  throw new Error("PORTAL_DEV_LOGIN=1 is refused when NODE_ENV=production")
}

/** Dev personas: labels only. In dev mode they all reach Fleet as the same credential. */
export const DEV_PERSONAS: Record<string, { name: string; email: string; roles: string[] }> = {
  avery: { name: "Avery (Platform)", email: "avery@example.com", roles: [DEV_ROLES.platform, DEV_ROLES.builder] },
  jordan: { name: "Jordan (Builder)", email: "jordan@example.com", roles: [DEV_ROLES.builder] },
  sam: { name: "Sam (Consumer)", email: "sam@example.com", roles: [DEV_ROLES.consumer] },
}

/** Roles from the id_token at `OIDC_ROLES_CLAIM`: a list of strings, or one string. */
function rolesFrom(claims: Record<string, unknown>): string[] {
  const v = claimAt(claims, config.oidc.rolesClaim)
  return Array.isArray(v) ? v.filter((r): r is string => typeof r === "string") : typeof v === "string" ? [v] : []
}

/**
 * The portal's own key for a user (call log, caches): the subject claim when the id_token
 * carries it, else `sub`. LangSmith reads the subject claim from the ACCESS token, which the
 * sign-in check requires; some providers (Okta's `uid`) put it only there.
 */
function userIdFrom(claims: Record<string, unknown>): string {
  const v = claimAt(claims, config.oidc.subjectClaim)
  return typeof v === "string" && v ? v : typeof claims.sub === "string" ? claims.sub : ""
}

const providers: NextAuthConfig["providers"] = []
if (DEV_LOGIN) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Dev persona",
      credentials: { persona: { label: "Persona" } },
      authorize: async (creds) => {
        const key = String(creds?.persona ?? "")
        const p = DEV_PERSONAS[key]
        if (!p) return null
        return { id: `dev-${key}`, name: p.name, email: p.email, roles: p.roles } as never
      },
    }),
  )
} else {
  providers.push({
    id: "oidc",
    name: config.oidc.displayName,
    type: "oidc",
    // Pinned: Auth.js checks the discovery document's issuer and every id_token's `iss`
    // against this exact string, so tokens minted for another tenant or realm are refused.
    issuer: config.oidc.issuer,
    clientId: config.oidc.clientId,
    clientSecret: config.oidc.clientSecret,
    authorization: {
      params: { scope: oidcScope(), ...(config.oidc.audienceParam ? { audience: config.oidc.audienceParam } : {}) },
    },
    profile: (p: Record<string, unknown>) => ({
      id: userIdFrom(p),
      name: (p.name ?? p.preferred_username ?? null) as string | null,
      email: (p.email ?? p.preferred_username ?? null) as string | null,
    }),
  })
}

/** The login page turns these into sentences (app/login/page.tsx). */
function refused(reason: string, got?: string): string {
  const q = new URLSearchParams({ error: "TokenRejected", reason })
  if (got) q.set("got", got.slice(0, 200))
  return `/login?${q}`
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    signIn({ profile, account }) {
      if (account?.provider === "dev") return true
      if (!profile || !userIdFrom(profile as Record<string, unknown>)) return false
      // Will LangSmith accept the access token? Say why not, here, instead of 401s later.
      const problem = accessTokenProblem(account?.access_token)
      if (problem) {
        console.warn(`[portal] sign-in refused: access token ${problem.reason}${problem.got ? ` (${problem.got})` : ""}`)
        return refused(problem.reason, problem.got)
      }
      if (!account?.refresh_token) return refused("no_refresh")
      return true
    },
    async jwt({ token, user, profile, account }) {
      if (account?.provider === "dev" && user) {
        token.uid = String(user.id)
        token.roles = ((user as { roles?: string[] }).roles ?? []).slice()
        token.dev = true
        return token
      }
      if (account && profile) {
        const claims = profile as Record<string, unknown>
        token.uid = userIdFrom(claims)
        token.roles = rolesFrom(claims)
        token.fleet =
          account.access_token && account.refresh_token
            ? { at: account.access_token, rt: account.refresh_token, exp: Number(account.expires_at ?? 0) }
            : undefined
        delete token.error
        return token
      }
      if (token.fleet && !fresh(token.fleet)) {
        try {
          token.fleet = await refreshFleetToken(token.fleet.rt)
        } catch (err) {
          console.warn(`[portal] ${err instanceof Error ? err.message : "Fleet token refresh failed"}; the user must sign in again`)
          delete token.fleet
          token.error = "refresh_failed"
        }
      }
      return token
    },
    session({ session, token }) {
      session.user = {
        name: session.user?.name,
        email: session.user?.email,
        uid: String(token.uid ?? ""),
        roles: token.roles ?? [],
        dev: token.dev ?? false,
        reauth: !token.dev && (!token.fleet || !!token.error),
      } as typeof session.user
      return session
    },
    // Pages need a session; API routes enforce their own (401 JSON, not a redirect).
    authorized({ auth: session, request }) {
      const p = request.nextUrl.pathname
      if (p === "/login" || p.startsWith("/api/")) return true
      return !!session?.user?.uid && !session.user.reauth
    },
  },
})
