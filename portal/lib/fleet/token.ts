import "server-only"

import { config, oidcScope } from "@/lib/config"

/**
 * The signed-in user's access token for the Fleet API. LangSmith checks it itself
 * (`FLEET_EXTERNAL_AUTH_OIDC_*`: issuer, audience, signature, expiry) and maps its subject
 * claim to a LangSmith user that already exists.
 *
 * Facts this module rests on:
 *   * Fleet checks iss/aud/exp/nbf/signature only, not `scp` or `typ`: send the ACCESS token.
 *   * A token from the configured issuer that fails a check is a 401 — there is no fall-through.
 *   * Some providers (Keycloak, Okta with rotation) revoke a refresh token once it is used.
 *     The dedupe below makes concurrent refreshes in THIS process share one call; that is
 *     why the chart runs one replica by default.
 *
 * Tokens live in the encrypted session cookie and, for a refresh, briefly in this process
 * (keyed by a hash). They never reach the browser and nothing here logs them.
 */

/** `exp` is epoch seconds. */
export type FleetTokens = { at: string; rt: string; exp: number }

export function fresh(t: FleetTokens | null | undefined): boolean {
  return !!t?.at && t.exp - Date.now() / 1000 > config.tokenMinTtlSec
}

// ── discovery: the token endpoint, cached for an hour ───────────────────────────
let discovered: { tokenEndpoint: string; until: number } | null = null

async function tokenEndpoint(): Promise<string> {
  if (discovered && discovered.until > Date.now()) return discovered.tokenEndpoint
  const res = await fetch(`${config.oidc.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  })
  const doc = (await res.json().catch(() => ({}))) as { token_endpoint?: unknown }
  if (!res.ok || typeof doc.token_endpoint !== "string") throw new Error(`OIDC discovery failed: HTTP ${res.status}`)
  discovered = { tokenEndpoint: doc.token_endpoint, until: Date.now() + 3_600_000 }
  return doc.token_endpoint
}

// ── refresh, deduplicated per refresh token ─────────────────────────────────────
type Pending = { p: Promise<FleetTokens>; until: number }
const g = globalThis as unknown as { __fleetRefresh?: Map<string, Pending> }
const pending = (g.__fleetRefresh ??= new Map())

async function keyOf(rt: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rt)))
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("")
}

/** client_secret_basic, encoded the way Auth.js does at sign-in. */
function basicAuth(): string {
  const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, "+")
  return `Basic ${btoa(`${enc(config.oidc.clientId)}:${enc(config.oidc.clientSecret)}`)}`
}

async function requestRefresh(rt: string): Promise<FleetTokens> {
  const res = await fetch(await tokenEndpoint(), {
    method: "POST",
    headers: { authorization: basicAuth(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: rt, scope: oidcScope() }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  })
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
  const ttl = Number(j.expires_in)
  if (!res.ok || typeof j.access_token !== "string" || !Number.isFinite(ttl) || ttl <= 0) {
    // The error code only: never the response body or the token.
    throw new Error(`token refresh failed: HTTP ${res.status} ${typeof j.error === "string" ? j.error : ""}`.trim())
  }
  console.info(`[portal] refreshed a Fleet token (expires in ${Math.round(ttl)} s)`)
  return {
    at: j.access_token,
    rt: typeof j.refresh_token === "string" && j.refresh_token ? j.refresh_token : rt,
    exp: Math.floor(Date.now() / 1000 + ttl),
  }
}

/** New tokens for a refresh token. Concurrent and same-request callers share one call. */
export async function refreshFleetToken(rt: string): Promise<FleetTokens> {
  const now = Date.now()
  for (const [k, v] of pending) if (v.until < now) pending.delete(k)
  const key = await keyOf(rt)
  const hit = pending.get(key)
  if (hit) return hit.p
  const p = requestRefresh(rt)
  pending.set(key, { p, until: now + 30_000 })
  p.then(
    (t) => pending.set(key, { p, until: (t.exp - config.tokenMinTtlSec) * 1000 }),
    () => pending.delete(key),
  )
  return p
}

// ── the sign-in check: will LangSmith accept this access token? ─────────────────

/** Why a sign-in was refused. `got` is shown on the login page, so it is kept to plain characters. */
export type TokenProblem = { reason: "not_jwt" | "alg" | "aud" | "iss" | "sub"; got?: string }

/** A JSON object from one base64url JWT segment, or null. */
function segment(part: string | undefined): Record<string, unknown> | null {
  if (!part) return null
  try {
    const bin = atob(part.replace(/-/g, "+").replace(/_/g, "/"))
    const v = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Read a claim by dot path (`realm_access.roles`). */
export function claimAt(claims: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), claims)
}

/**
 * Mirror LangSmith's own checks without verifying the signature (LangSmith does that):
 * an RSA/RSA-PSS/ECDSA/EdDSA-signed JWT whose `aud` contains the configured audience (a
 * list is fine), whose `iss` equals the configured issuer exactly, and which carries the
 * subject claim. Turns the usual misconfiguration into one plain sentence at sign-in
 * instead of a 401 on every page.
 */
export function accessTokenProblem(token: string | undefined): TokenProblem | null {
  const parts = (token ?? "").split(".")
  const header = parts.length === 3 ? segment(parts[0]) : null
  const claims = parts.length === 3 ? segment(parts[1]) : null
  if (!header || !claims) return { reason: "not_jwt" }
  const alg = String(header.alg ?? "")
  if (!/^(RS|PS|ES)(256|384|512)$|^EdDSA$/.test(alg)) return { reason: "alg", got: alg }
  const aud = Array.isArray(claims.aud) ? claims.aud.map(String) : claims.aud === undefined ? [] : [String(claims.aud)]
  if (!aud.includes(config.oidc.audience)) return { reason: "aud", got: aud.join(", ") || "(none)" }
  if (claims.iss !== config.oidc.issuer) return { reason: "iss", got: String(claims.iss ?? "(none)") }
  const sub = claimAt(claims, config.oidc.subjectClaim)
  if (typeof sub !== "string" || !sub) return { reason: "sub" }
  return null
}
