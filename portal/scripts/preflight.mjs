// Pre-flight checks for a deployed portal. Run by `helm test` in the portal image, or by hand:
//
//   LANGSMITH_API_URL=… OIDC_ISSUER=… AUTH_URL=… node scripts/preflight.mjs
//
// Checks what can be checked without a user: LangSmith answers and is new enough, the
// identity provider's discovery document matches OIDC_ISSUER exactly (LangSmith compares
// the issuer byte for byte), and the portal itself answers. It never needs a secret.
// Exit code 1 when a required check fails.

const env = process.env
const results = []
const MIN_LANGSMITH = [0, 17]

function record(ok, name, detail, { required = true } = {}) {
  results.push({ ok, name, detail, required })
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } })
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

function errText(err) {
  return err?.cause?.code ?? err?.name ?? String(err)
}

async function checkLangSmith() {
  const base = (env.LANGSMITH_API_URL ?? "").replace(/\/+$/, "")
  if (!base) return record(false, "LangSmith API", "LANGSMITH_API_URL is not set (Helm: langsmith.apiUrl)")
  try {
    const { status, body } = await getJson(`${base}/info`)
    if (status !== 200 || !body) return record(false, "LangSmith API", `${base}/info answered HTTP ${status}; is langsmith.apiUrl the API URL (usually ending in /api)?`)
    const version = String(body.version ?? "")
    const [maj, min] = version.split(".").map(Number)
    const oldVersion = Number.isFinite(maj) && (maj < MIN_LANGSMITH[0] || (maj === MIN_LANGSMITH[0] && min < MIN_LANGSMITH[1]))
    record(!oldVersion, "LangSmith API", `${base} is LangSmith ${version || "(version unknown)"}${oldVersion ? `; this portal needs ${MIN_LANGSMITH.join(".")} or later` : ""}`)
  } catch (err) {
    record(false, "LangSmith API", `${base}/info unreachable from the cluster (${errText(err)})`)
  }
}

async function checkIssuer() {
  const issuer = env.OIDC_ISSUER ?? ""
  if (!issuer) return record(false, "Identity provider", "OIDC_ISSUER is not set (Helm: oidc.issuer)")
  const url = `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`
  try {
    const { status, body } = await getJson(url)
    if (status !== 200 || !body) return record(false, "Identity provider", `${url} answered HTTP ${status}`)
    if (body.issuer !== issuer)
      return record(false, "Identity provider", `discovery says issuer "${body.issuer}" but oidc.issuer is "${issuer}". They must match exactly (watch for a trailing slash), here and in LangSmith's FLEET_EXTERNAL_AUTH_OIDC_ISSUER_URL.`)
    const missing = ["authorization_endpoint", "token_endpoint", "userinfo_endpoint", "jwks_uri"].filter((k) => typeof body[k] !== "string")
    if (missing.length) return record(false, "Identity provider", `discovery document has no ${missing.join(", ")}`)
    record(true, "Identity provider", `${issuer} (discovery OK, issuer matches exactly)`)
  } catch (err) {
    record(false, "Identity provider", `${url} unreachable from the cluster (${errText(err)})`)
  }
}

async function checkPortal() {
  const svc = (env.PORTAL_SERVICE_URL ?? "").replace(/\/+$/, "")
  if (svc) {
    try {
      const { status } = await getJson(`${svc}/api/health`)
      record(status === 200, "Portal (in cluster)", `${svc}/api/health answered HTTP ${status}`)
    } catch (err) {
      record(false, "Portal (in cluster)", `${svc}/api/health unreachable (${errText(err)}); is the pod running? kubectl logs shows configuration problems`)
    }
  }
  const pub = (env.AUTH_URL ?? "").replace(/\/+$/, "")
  if (pub) {
    // Through DNS and the ingress. Some clusters cannot reach their own public address, so a
    // failure here is a warning; open the URL in a browser to be sure.
    try {
      const { status } = await getJson(`${pub}/api/health`)
      record(status === 200, "Portal (public URL)", `${pub}/api/health answered HTTP ${status}`, { required: false })
    } catch (err) {
      record(false, "Portal (public URL)", `${pub}/api/health not reachable from inside the cluster (${errText(err)}); check DNS, ingress and TLS from a browser`, { required: false })
    }
  }
}

await Promise.all([checkLangSmith(), checkIssuer(), checkPortal()])

const ORDER = ["LangSmith API", "Identity provider", "Portal (in cluster)", "Portal (public URL)"]
results.sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name))
for (const r of results) console.log(`${r.ok ? "PASS" : r.required ? "FAIL" : "WARN"}  ${r.name}: ${r.detail}`)
if (env.AUTH_URL) console.log(`\nRedirect URI to register on the portal's app in your identity provider:\n  ${env.AUTH_URL.replace(/\/+$/, "")}/api/auth/callback/oidc`)
const failed = results.filter((r) => !r.ok && r.required).length
console.log(failed ? `\n${failed} check(s) failed.` : "\nAll required checks passed. Next: sign in at the portal URL.")
process.exit(failed ? 1 : 0)
