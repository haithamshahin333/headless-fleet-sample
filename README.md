# Headless Fleet Starter

A portal for AI agents on the **LangSmith Headless Fleet API**. You run the portal in your own
Kubernetes cluster. People sign in with your identity provider. Then the portal calls
LangSmith **as that person**, with the access token of that person. LangSmith applies the
settings of your platform team to each person. The portal has no policy code. These settings
include:

- roles and access policies
- the models and tools that people can use
- spend limits
- sharing

> **Self-hosted LangSmith 0.17 or later is necessary.** LangSmith Cloud (SaaS) does not have
> per-user sign-in for Fleet. Dev mode works with LangSmith Cloud and one shared API key. Use
> dev mode for UI work only.

## Guides

| Guide | Use it to |
|---|---|
| [docs/identity-provider.md](docs/identity-provider.md) | Set up your identity provider: Entra ID (tested), Keycloak, Okta, Auth0. |
| [docs/langsmith.md](docs/langsmith.md) | Prepare LangSmith: per-user sign-in for Fleet, and how to set up users. |
| [docs/governance.md](docs/governance.md) | Control models, tools, spend and sharing in LangSmith. |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Find the cause of an error and the fix. |
| [docs/mcp-servers.md](docs/mcp-servers.md) | Optional: connect your own MCP server, also on a private network. |
| [Headless Fleet Customer Guide](https://mirror-feeling-d80.notion.site/Headless-Fleet-Customer-Guide-397808527b1781018fc7d13a541d2efd) (LangChain) | The reference for the LangSmith side and the Fleet API. Its "Identity & SSO with OIDC" page tells how LangSmith checks the tokens of the portal. |
| [Enable Fleet on self-hosted LangSmith](https://docs.langchain.com/langsmith/enable-self-hosted-fleet) (LangChain) | Turn on Fleet before you start. |

## What people can do

| | Who | What |
|---|---|---|
| **Use** | Everyone | Chat with agents: your agents, agents shared with you, and agents published to your workspace. Each person has their own history. The portal shows approval steps. Before the first message, it makes sure that the accounts of the agent are connected *for you*. |
| **Build** | `roles.builders` | Select models, tools, skills, subagents and a computer from what LangSmith lets *you* use. Restricted tools show a lock. Write or upload skills (a folder or a `.zip`). Test an agent in a chat before you publish it. |
| **Publish** | `roles.builders` | Share an agent with named people or with the whole workspace, at the Run, Clone or Edit level. Archive an agent. |
| **Govern** | Platform team | **In LangSmith, not in the portal.** See [docs/governance.md](docs/governance.md). |

Each refusal tells you which part refused. "Enforced by LangSmith" is a LangSmith control.
"Portal" is a check of the portal itself: sign-in, CSRF or the role of the person.

## How it works

```
Browser ──(same origin, encrypted session cookie)──► portal (Next.js, one pod)
                                                       ├─ sign-in: your OIDC provider → id + roles
                                                       │    + the person's access/refresh token (server-side only)
                                                       └─ /api/** ──► https://<langsmith>/api/v1/fleet/*
                                                            Authorization: Bearer <that person's access token>
                                                            X-Tenant-Id: their selected workspace
LangSmith: checks iss, aud, signature and expiry, then finds the user by the subject claim,
then applies that user's RBAC, ABAC, model access, spend caps and sharing
```

- **The browser never sees a token.** The tokens are only in the encrypted session cookie. The
  server gets new tokens before the old tokens are no longer valid.
- **There is no shared secret.** A stolen token acts as one person, for about one hour.
- **The portal stores nothing.** It has no database. A pod restart does not sign anyone out.

## Before you start

You need all of these items. The guide in the second column tells you how to get each one.

| | Item | Guide |
|---|---|---|
| [ ] | Self-hosted LangSmith **0.17 or later**, with an Enterprise license that has Fleet. | |
| [ ] | **Fleet is on and works** in that LangSmith. This starter does not turn Fleet on. | [Enable Fleet on self-hosted LangSmith](https://docs.langchain.com/langsmith/enable-self-hosted-fleet) |
| [ ] | LangSmith SSO through **OIDC**, with the identity provider that the portal will use. | [docs/langsmith.md](docs/langsmith.md) |
| [ ] | **Each person already has a LangSmith user.** The simplest way: each person signs in to LangSmith one time. LangSmith refuses people that it does not know. | [docs/langsmith.md](docs/langsmith.md#users-must-already-exist-in-langsmith) |
| [ ] | Rights in your identity provider to make an app for the portal. For Entra ID, you must also own the LangSmith app registration. To assign groups to app roles, you need Entra ID P1 or P2. | [docs/identity-provider.md](docs/identity-provider.md) |
| [ ] | Rights to change the Helm release of LangSmith. | |
| [ ] | Kubernetes **1.27 or later**, where you can run `helm install`. | |
| [ ] | An ingress controller, a DNS name for the portal, and a TLS certificate (from cert-manager or from your own Secret). | |
| [ ] | A container registry that the cluster can pull from. | |
| [ ] | On your computer: Docker with `buildx`, Helm 3.8 or later (or Helm 4), and `kubectl`. | |

## Your inputs

This table shows every value that comes from your environment. Section 1 of
[`values.yaml`](chart/headless-fleet-portal/values.yaml) has the same values. **Must match**
shows a value that must be the same in a different system.

| # | Input | Where you get it | Portal chart value | Must match |
|---|---|---|---|---|
| 1 | The URL of the portal | You select it (DNS + TLS) | `portal.url` | The redirect URI `<url>/api/auth/callback/oidc` in your identity provider |
| 2 | The LangSmith API URL | Your LangSmith install, usually `https://<host>/api` | `langsmith.apiUrl` | — |
| 3 | The issuer URL | Your identity provider | `oidc.issuer` | LangSmith `FLEET_EXTERNAL_AUTH_OIDC_ISSUER_URL`, **character for character** |
| 4 | The client ID of the portal | The portal app in your identity provider | `oidc.clientId` | — |
| 5 | The LangSmith audience | The app or API in your identity provider that LangSmith trusts | `oidc.audience` | LangSmith `FLEET_EXTERNAL_AUTH_OIDC_AUDIENCE` |
| 6 | How tokens get that audience | Entra ID: a scope. Auth0: an `audience` parameter. Keycloak and Okta: a setting in the identity provider | `oidc.apiScope` / `oidc.audienceParam` | — |
| 7 | The subject claim | `oid` on Entra ID, `sub` on most others | `oidc.subjectClaim` | LangSmith `FLEET_EXTERNAL_AUTH_OIDC_SUBJECT_CLAIM`, and the ID that LangSmith keeps for each user |
| 8 | The client secret and a session key | Your identity provider, and `openssl rand -base64 32` | The Secret in `secrets.existingSecret` | — |
| 9 | The image | Your registry, after step 3 | `image.repository`, `image.tag` | — |
| 10 | The ingress class | Your cluster (`kubectl get ingressclass`) | `ingress.className` | — |
| 11 | The TLS certificate | A cert-manager issuer, or your own TLS Secret | `ingress.annotations` or `ingress.tls.secretName` | — |
| 12 | Builder and admin roles *(optional)* | The roles or groups in your identity provider | `roles.claim`, `roles.builders`, `roles.admins` | — |

If you do not set a necessary value, `helm install` stops. It lists all the values that you must set.

## Install

Do the steps in this order. **Run every command from the root of this repo.** The examples
use the release name `portal` and the namespace `agent-portal`.

### 1. Set up your identity provider

Make an app for the portal. Make sure that the access tokens are tokens that LangSmith
accepts. Add roles if you want them. Follow
[docs/identity-provider.md](docs/identity-provider.md).

For Entra ID, do the sections of the guide in order. Section 2 needs the client ID of the
portal app from section 1.

Register the redirect URI `<portal.url>/api/auth/callback/oidc` on the app of the portal.

### 2. Prepare LangSmith

Add per-user sign-in for Fleet to your LangSmith release. Read
[docs/langsmith.md](docs/langsmith.md) first. The
[Headless Fleet Customer Guide](https://mirror-feeling-d80.notion.site/Headless-Fleet-Customer-Guide-397808527b1781018fc7d13a541d2efd)
is the reference for these settings.

If you manage LangSmith with a different tool (for example Argo CD or Terraform), add the
values of `langsmith/values-fleet-oidc.yaml` in that tool. Otherwise, do these steps:

1. Find the release name and the chart version of LangSmith:

   ```bash
   helm list -n <langsmith-namespace>
   ```

2. Save the current values of the release. This file can contain secrets. Do not commit it.

   ```bash
   helm get values <langsmith-release> -n <langsmith-namespace> -o yaml > my-values-langsmith-current.yaml
   ```

3. Copy the values for Fleet sign-in. Replace each `<…>` in the copy.

   ```bash
   cp langsmith/values-fleet-oidc.yaml my-values-langsmith-fleet.yaml
   ```

4. Compare the two files. Helm replaces lists. It does not merge them. If
   `my-values-langsmith-current.yaml` has `platformBackend.deployment.extraEnv`, copy those
   entries into the same list in `my-values-langsmith-fleet.yaml`.

5. Upgrade LangSmith with the **same chart version**. Do a dry run first:

   ```bash
   helm repo add langchain https://langchain-ai.github.io/helm/   # only if you do not have it
   helm repo update
   helm upgrade <langsmith-release> langchain/langsmith -n <langsmith-namespace> --version <chart-version> \
     -f my-values-langsmith-current.yaml -f my-values-langsmith-fleet.yaml --dry-run
   ```

   If the dry run has no errors, run the same command without `--dry-run`.

The two `my-values-*.yaml` files are in `.gitignore`.

### 3. Build the image and push it to your registry

Sign in to your registry (for example `docker login <registry>`, or `az acr login -n <name>`
for Azure Container Registry). Then build the image:

```bash
docker buildx build --platform linux/amd64 \
  -t <registry>/headless-fleet-portal:0.1.0 --push portal
```

Keep `--platform linux/amd64` on Apple silicon. Without it, the image is for arm64. Most
nodes cannot run it, and the pod log shows `exec format error`.

### 4. Make the namespace and the Secret

The chart does not keep secrets. Put them in a Secret. These commands do not put the client
secret in your shell history:

```bash
kubectl create namespace agent-portal
read -rs OIDC_CLIENT_SECRET     # paste the client secret of the portal, then push Enter
kubectl create secret generic headless-fleet-portal -n agent-portal \
  --from-literal=oidc-client-secret="$OIDC_CLIENT_SECRET" \
  --from-literal=auth-secret="$(openssl rand -base64 32)"
unset OIDC_CLIENT_SECRET
```

For a private registry, also make a pull secret:

```bash
kubectl create secret docker-registry regcred -n agent-portal \
  --docker-server=<registry> --docker-username=<user> --docker-password=<password>
```

### 5. Fill in your values

1. Copy the example for your identity provider:

   ```bash
   cp chart/headless-fleet-portal/examples/values-entra.yaml my-values.yaml   # or values-keycloak / values-okta
   ```

2. Replace each `<…>` in `my-values.yaml`.

3. Set the ingress. Replace the `annotations: {}` line of the example with a block like this:

   ```yaml
   ingress:
     className: nginx                                       # from: kubectl get ingressclass
     annotations:
       cert-manager.io/cluster-issuer: <issuer>             # if you use cert-manager
       nginx.ingress.kubernetes.io/proxy-body-size: "8m"    # skill uploads; ingress-nginx allows 1 MB by default
   ```

   If you do not use cert-manager, make a TLS Secret for the host of the portal. Then set
   `ingress.tls.secretName` to its name:

   ```bash
   kubectl create secret tls portal-tls -n agent-portal --cert=<cert.pem> --key=<key.pem>
   ```

   For the Gateway API, set `ingress.enabled: false` and `httpRoute.enabled: true`. See
   [`values.yaml`](chart/headless-fleet-portal/values.yaml).

4. For a private registry, add the pull secret:

   ```yaml
   imagePullSecrets:
     - name: regcred
   ```

### 6. Install, test and sign in

```bash
helm install portal chart/headless-fleet-portal -n agent-portal -f my-values.yaml --wait --timeout 5m
helm test portal -n agent-portal --logs
```

The install notes show the exact redirect URI. Make sure that it is the URI from step 1.

`helm test` does three checks from inside the cluster:

- LangSmith answers, and its version is 0.17 or later.
- Your issuer is the same as the issuer in its discovery document.
- The portal answers.

Then open `portal.url` and sign in. If LangSmith does not accept the token, the sign-in page
tells you why.

If a step fails, see [docs/troubleshooting.md](docs/troubleshooting.md). If the pod does not
start, its log lists each configuration problem:

```bash
kubectl logs -n agent-portal deploy/portal-headless-fleet-portal
```

## After the install

### Change settings

```bash
helm upgrade portal chart/headless-fleet-portal -n agent-portal -f my-values.yaml --wait
```

The pod restarts after each change of a setting.

If you change the Secret, restart the pod:

```bash
kubectl rollout restart deployment/portal-headless-fleet-portal -n agent-portal
```

A new `auth-secret` signs out all people.

### Install a new version of the portal

1. Build the image with a **new tag**, for example `0.1.1`. The nodes keep the old image if the tag is the same.
2. Set `image.tag` in `my-values.yaml` to the new tag.
3. Run the `helm upgrade` command above.

### Upgrade LangSmith

Each later LangSmith upgrade must also use `my-values-langsmith-fleet.yaml`. If you do not use
it, per-user sign-in for Fleet stops, and the portal gets 401 errors.

### Remove the portal

```bash
helm uninstall portal -n agent-portal
kubectl delete namespace agent-portal      # also removes the Secrets and the helm test pod
```

Then:

1. Remove the app of the portal, or its redirect URI, from your identity provider.
2. If no other client uses per-user sign-in for Fleet, remove the `FLEET_EXTERNAL_AUTH_*`
   entries from `my-values-langsmith-fleet.yaml`. Then upgrade LangSmith again.

## Next (optional): your own MCP server

Agents can use tools from an MCP server behind your own OAuth provider. Each person connects
their account one time. The portal asks for the connection before the first message. Follow
[docs/mcp-servers.md](docs/mcp-servers.md).

If the MCP server or its OAuth provider has a private IP address, LangSmith needs one more
setting. The guide tells you when you need it and where to set it.
[`examples/mcp-whoami/`](examples/mcp-whoami/) has a test MCP server with Keycloak.

## Local development

You need Node.js 24.

```bash
cd portal
npm install
cp .env.local.example .env.local      # fill in the Required section
npm run dev                           # http://localhost:3100
```

Register `http://localhost:3100/api/auth/callback/oidc` in your identity provider for local
sign-in.

**Dev mode** (`PORTAL_DEV_LOGIN=1`) does not use an identity provider:

- It shows three personas (Platform, Builder, Consumer) in place of sign-in.
- It calls LangSmith with **one** API key, so LangSmith sees one user.
- It works with LangSmith Cloud.
- Use it for UI work only. Governance for each person works only with a real identity provider.
- Dev mode does not start when `NODE_ENV=production`.

**Check from a terminal:** [`portal/scripts/smoke.ts`](portal/scripts/smoke.ts) does the same Fleet
operations as the portal. Run it from `portal/`:

```bash
npx tsx --env-file=.env.local scripts/smoke.ts               # what the caller can see
npx tsx --env-file=.env.local scripts/smoke.ts --lifecycle   # make, run, share and delete a test agent
```

Set `SMOKE_BEARER=<access token of a person>` to see what that person can see.

## Repository layout

| Path | What it is |
|---|---|
| `portal/` | The Next.js app, its `Dockerfile` and `.env.local.example` |
| `portal/auth.ts` | OIDC sign-in, the check of the access token, the dev personas |
| `portal/lib/config.ts` | All settings, checked at startup |
| `portal/lib/fleet/` | The Fleet client, the operations, token refresh, streaming |
| `portal/app/api/**` | Route handlers (session → Fleet calls for that person) |
| `portal/scripts/preflight.mjs` | The `helm test` checks |
| `chart/headless-fleet-portal/` | The Helm chart, with `examples/` for each identity provider |
| `langsmith/values-fleet-oidc.yaml` | The values to add to your LangSmith release |
| `docs/` | The guides (see [Guides](#guides)) |
| `examples/mcp-whoami/` | A test MCP server behind Keycloak, for [docs/mcp-servers.md](docs/mcp-servers.md) |

## Tested with

- Self-hosted LangSmith chart 0.17.6 / app 0.17.33 on AKS, with Microsoft Entra ID, ingress-nginx and cert-manager.
- Self-hosted LangSmith chart 0.17.25 / app 0.17.53 on the same cluster:
  - sign-in, Build and chat
  - a custom MCP server behind Keycloak 26.8.0, on private addresses ([docs/mcp-servers.md](docs/mcp-servers.md#tested-with))
- Keycloak, Okta and Auth0 as the sign-in provider of the portal: **not tested yet**. The guides have settings for them.

## License

MIT. See [LICENSE](LICENSE).
