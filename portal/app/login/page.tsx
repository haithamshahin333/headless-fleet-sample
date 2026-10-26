import { redirect } from "next/navigation"

import { auth, DEV_LOGIN, DEV_PERSONAS } from "@/auth"
import { config } from "@/lib/config"
import { loginAsDevPersona, loginWithOidc } from "../actions"

export const metadata = { title: "Sign in" }

/** Only same-origin paths survive — `callbackUrl` (Auth.js) may be absolute. */
function safePath(raw?: string): string {
  if (!raw) return "/"
  try {
    const u = new URL(raw, "http://local")
    const p = u.pathname + u.search
    return u.origin === "http://local" || u.origin === new URL(process.env.AUTH_URL ?? "http://local").origin ? (p.startsWith("//") ? "/" : p) : "/"
  } catch {
    return "/"
  }
}

/**
 * Why the sign-in check in auth.ts refused the access token, as one sentence. Only `reason`
 * picks the sentence; `got` (a value from the token) is shown only if it is plain text, so a
 * crafted link cannot put arbitrary words on this page.
 */
function rejection(reason?: string, got?: string): string | null {
  const value = got && /^[\w.:/@,\- ()]{1,200}$/.test(got) ? got : null
  const o = config.oidc
  switch (reason) {
    case "not_jwt":
      return "Your identity provider issued an access token LangSmith can't read. LangSmith needs a JWT access token issued for its API."
    case "alg":
      return `The access token is signed with ${value ?? "an algorithm"} LangSmith does not accept. It needs RSA, RSA-PSS, ECDSA or EdDSA (not HMAC).`
    case "aud":
      return `The access token is for ${value ?? "another audience"}, but LangSmith expects ${o.audience}. Configure your identity provider (or oidc.apiScope / oidc.audienceParam) so the token is issued for LangSmith.`
    case "iss":
      return `The access token was issued by ${value ?? "another issuer"}, but the portal and LangSmith expect ${o.issuer}. The two must match exactly.`
    case "sub":
      return `The access token has no "${o.subjectClaim}" claim, which LangSmith uses to find your account.`
    case "no_refresh":
      return "Your identity provider did not issue a refresh token. Allow offline_access for the portal."
    default:
      return null
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; callbackUrl?: string; error?: string; reason?: string; got?: string }>
}) {
  const sp = await searchParams
  const next = safePath(sp.next ?? sp.callbackUrl)
  const error = sp.error
  const why = error === "TokenRejected" ? rejection(sp.reason, sp.got) : null
  const session = await auth()
  if (session?.user?.uid && !session.user.reauth) redirect(next)

  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-2xl bg-card p-7 shadow-pop ring-1 ring-border/60">
        <div className="mb-5 flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand shadow-card">
            <svg viewBox="0 0 12 12" fill="none" className="h-3.5 w-3.5" aria-hidden>
              <path d="M2 6h8M6 2v8" stroke="currentColor" className="text-brand-foreground" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
          {config.portalName}
        </div>
        <p className="mb-5 text-[13px] leading-relaxed text-muted-foreground">
          Use, build and share AI agents. What you can do here is set by your platform team in LangSmith.
        </p>

        {error && (
          <p className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
            {why ? (
              <>
                <b>Sign-in refused.</b> {why}
              </>
            ) : (
              <>Sign-in failed ({error}). If this keeps happening, your account may not be set up for the portal.</>
            )}
          </p>
        )}

        {DEV_LOGIN ? (
          <div className="flex flex-col gap-2">
            <p className="mb-1 rounded-xl border border-dashed px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
              <b className="text-foreground">Dev sign-in.</b> No identity provider; every persona reaches LangSmith with the
              same API key, so LangSmith sees one user. Use this to work on the UI — governance differences need a real
              identity provider and OIDC bearer.
            </p>
            {Object.entries(DEV_PERSONAS).map(([key, p]) => (
              <form key={key} action={loginAsDevPersona}>
                <input type="hidden" name="persona" value={key} />
                <input type="hidden" name="next" value={next} />
                <button className="flex w-full items-center justify-between rounded-xl bg-background px-3.5 py-2.5 text-left text-[13px] ring-1 ring-border/70 transition-colors hover:bg-accent/60">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-[11px] text-muted-foreground">{p.roles.join(" · ")}</span>
                </button>
              </form>
            ))}
          </div>
        ) : (
          <form action={loginWithOidc}>
            <input type="hidden" name="next" value={next} />
            <button className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-brand text-[13.5px] font-medium text-brand-foreground shadow-card transition-[filter] hover:brightness-110">
              Sign in with {config.oidc.displayName}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
