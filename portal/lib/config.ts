import { z } from "zod"

/**
 * Every setting the portal reads, in one place. Read once at startup; `instrumentation.ts`
 * refuses to start the server when `configProblems()` is not empty, so a bad deployment is
 * a crash with a readable log, not a stream of 500s later.
 *
 * Each problem names the environment variable AND the Helm value that sets it, because the
 * person reading the log usually installed the chart, not the app.
 *
 * Nothing here is NEXT_PUBLIC_: none of it reaches the browser bundle, and none of it is
 * frozen at build time. One image serves any environment.
 */

const e = process.env

export const DEV_LOGIN = e.PORTAL_DEV_LOGIN === "1"

/** Role values the dev personas carry; they count as builders when no roles are configured. */
export const DEV_ROLES = { platform: "Portal.Platform", builder: "Portal.Builder", consumer: "Portal.Consumer" } as const

function list(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

function trimSlash(v: string | undefined): string {
  return (v ?? "").trim().replace(/\/+$/, "")
}

export const config = {
  devLogin: DEV_LOGIN,
  /** The URL people open. Auth.js callback base, CSRF origin, secure cookies. */
  authUrl: (e.AUTH_URL ?? "").trim(),
  portalName: (e.PORTAL_NAME ?? "").trim() || "Agent Portal",
  oidc: {
    /** Pinned: Auth.js rejects tokens from any other issuer. Must equal LangSmith's FLEET_EXTERNAL_AUTH_OIDC_ISSUER_URL. */
    issuer: (e.OIDC_ISSUER ?? "").trim(),
    clientId: (e.OIDC_CLIENT_ID ?? "").trim(),
    clientSecret: e.OIDC_CLIENT_SECRET ?? "",
    /** The `aud` LangSmith accepts (FLEET_EXTERNAL_AUTH_OIDC_AUDIENCE). Checked at sign-in. */
    audience: (e.OIDC_AUDIENCE ?? "").trim(),
    /** Extra scope that makes the IdP issue an access token for LangSmith (Entra: api://<app>/Fleet.Access). */
    apiScope: (e.OIDC_API_SCOPE ?? "").trim(),
    /** Sent as `audience` on the authorization request (Auth0). */
    audienceParam: (e.OIDC_AUDIENCE_PARAM ?? "").trim(),
    /** The claim LangSmith maps to a user (FLEET_EXTERNAL_AUTH_OIDC_SUBJECT_CLAIM). Entra: oid. */
    subjectClaim: (e.OIDC_SUBJECT_CLAIM ?? "").trim() || "sub",
    /** Dot path to the roles in the id_token: `roles` (Entra), `groups` (Okta), `realm_access.roles` (Keycloak). */
    rolesClaim: (e.OIDC_ROLES_CLAIM ?? "").trim() || "roles",
    displayName: (e.OIDC_DISPLAY_NAME ?? "").trim() || "your organization",
  },
  /** UX gating only. Empty = Build is off for everyone (dev mode: the personas' roles). */
  builderRoles: list(e.PORTAL_BUILDER_ROLES).length
    ? list(e.PORTAL_BUILDER_ROLES)
    : DEV_LOGIN
      ? [DEV_ROLES.builder, DEV_ROLES.platform]
      : [],
  adminRoles: list(e.PORTAL_ADMIN_ROLES).length ? list(e.PORTAL_ADMIN_ROLES) : DEV_LOGIN ? [DEV_ROLES.platform] : [],
  langsmith: {
    /** The portal calls <apiUrl>/v1/fleet/*. Dev mode defaults to LangSmith SaaS. */
    apiUrl: trimSlash(e.LANGSMITH_API_URL) || (DEV_LOGIN ? "https://api.smith.langchain.com" : ""),
    /** Shown to admins as "Admin in LangSmith". */
    uiUrl: trimSlash(e.LANGSMITH_UI_URL) || undefined,
    orgId: (e.LANGSMITH_ORG_ID ?? "").trim() || undefined,
    defaultWorkspace: (e.LANGSMITH_WORKSPACE_ID ?? "").trim() || undefined,
  },
  /** Refresh the access token when fewer seconds than this remain. */
  tokenMinTtlSec: (() => {
    const n = Number(e.PORTAL_TOKEN_MIN_TTL_SEC ?? 300)
    return Number.isFinite(n) && n >= 0 ? n : 300
  })(),
  /** Fleet OAuth provider for the Computer → Microsoft Graph access profile. */
  graphProvider: (e.PORTAL_GRAPH_PROVIDER ?? "").trim() || "microsoft-oauth-provider",
}

/** Scopes requested at sign-in and on refresh. */
export function oidcScope(): string {
  return ["openid", "profile", "email", "offline_access", ...config.oidc.apiScope.split(/\s+/)].filter(Boolean).join(" ")
}

// ── validation ──────────────────────────────────────────────────────────────────

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"])

/** An absolute URL; https unless the host is local. */
function url(name: string, helm: string, example: string, opts: { rootOnly?: boolean } = {}) {
  const where = `${name} (Helm: ${helm})`
  return z.string().superRefine((v, ctx) => {
    if (!v) return ctx.addIssue({ code: "custom", message: `${where} is required, e.g. ${example}` })
    let u: URL
    try {
      u = new URL(v)
    } catch {
      return ctx.addIssue({ code: "custom", message: `${where} is not a URL: "${v}". Expected e.g. ${example}` })
    }
    if (u.protocol !== "https:" && !(u.protocol === "http:" && LOCAL.has(u.hostname)))
      ctx.addIssue({ code: "custom", message: `${where} must use https:// (http:// only for localhost): "${v}"` })
    if (opts.rootOnly && u.pathname !== "/")
      ctx.addIssue({ code: "custom", message: `${where} must be the root of a host, without a path: "${v}"` })
  })
}

function required(name: string, helm: string, hint: string) {
  return z.string().refine((v) => v.length > 0, { message: `${name} (Helm: ${helm}) is required: ${hint}` })
}

const claimPath = (name: string, helm: string) =>
  z.string().regex(/^[A-Za-z0-9_:\-]+(\.[A-Za-z0-9_:\-]+)*$/, { message: `${name} (Helm: ${helm}) must be a claim name or a dot path such as realm_access.roles` })

const Production = z.object({
  authUrl: url("AUTH_URL", "portal.url", "https://agents.example.com", { rootOnly: true }),
  authSecret: z.string().refine((v) => v.length >= 32, {
    message: "AUTH_SECRET (Helm: the auth-secret key of secrets.existingSecret) is required, at least 32 characters. Generate one: openssl rand -base64 32",
  }),
  issuer: url("OIDC_ISSUER", "oidc.issuer", "https://login.microsoftonline.com/<tenant-id>/v2.0"),
  clientId: required("OIDC_CLIENT_ID", "oidc.clientId", "the portal's client (application) ID in your identity provider"),
  clientSecret: required("OIDC_CLIENT_SECRET", "the oidc-client-secret key of secrets.existingSecret", "the portal's client secret"),
  audience: required("OIDC_AUDIENCE", "oidc.audience", "the same value as LangSmith's FLEET_EXTERNAL_AUTH_OIDC_AUDIENCE"),
  apiUrl: url("LANGSMITH_API_URL", "langsmith.apiUrl", "https://langsmith.example.com/api"),
  subjectClaim: claimPath("OIDC_SUBJECT_CLAIM", "oidc.subjectClaim"),
  rolesClaim: claimPath("OIDC_ROLES_CLAIM", "roles.claim"),
})

const Dev = z.object({
  authSecret: z.string().refine((v) => v.length >= 32, { message: "AUTH_SECRET is required, at least 32 characters. Generate one: openssl rand -base64 32" }),
  apiKey: required("LANGSMITH_API_KEY", "dev mode only", "dev mode calls LangSmith with one API key for every persona"),
})

/** Every problem with the configuration, one sentence each. Empty means the portal can start. */
export function configProblems(): string[] {
  const authSecret = e.AUTH_SECRET ?? ""
  if (DEV_LOGIN) {
    const problems: string[] = []
    if (e.NODE_ENV === "production") problems.push("PORTAL_DEV_LOGIN=1 is refused when NODE_ENV=production.")
    const r = Dev.safeParse({ authSecret, apiKey: e.LANGSMITH_API_KEY ?? "" })
    return [...problems, ...(r.success ? [] : r.error.issues.map((i) => i.message))]
  }
  const r = Production.safeParse({
    authUrl: config.authUrl,
    authSecret,
    issuer: config.oidc.issuer,
    clientId: config.oidc.clientId,
    clientSecret: config.oidc.clientSecret,
    audience: config.oidc.audience,
    apiUrl: config.langsmith.apiUrl,
    subjectClaim: config.oidc.subjectClaim,
    rolesClaim: config.oidc.rolesClaim,
  })
  return r.success ? [] : r.error.issues.map((i) => i.message)
}

/** Lines worth logging at startup that are not errors. */
export function configNotes(): string[] {
  const notes: string[] = []
  if (!config.builderRoles.length)
    notes.push("Build and Publish are turned off: no builder roles are configured (PORTAL_BUILDER_ROLES, Helm: roles.builders).")
  if (DEV_LOGIN) notes.push("Dev sign-in is on: every persona reaches LangSmith with ONE API key, so LangSmith sees one user.")
  return notes
}
