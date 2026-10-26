# Connect your own MCP server

Fleet agents can use tools from an MCP server that you operate. This page tells you how to
connect an MCP server that uses your own OAuth provider. Each person connects their account
one time. Then LangSmith calls the MCP server with the token of that person.

The worked example uses Keycloak. [`examples/mcp-whoami/`](../examples/mcp-whoami/) has a
test MCP server and a Keycloak realm that you can deploy in a namespace.

LangChain's reference for the LangSmith side is
[Remote MCP servers](https://docs.langchain.com/langsmith/fleet/remote-mcp-servers). For the
same steps through the API, see the "Tools, Integrations & Connections" page of the
[Headless Fleet Customer Guide](https://mirror-feeling-d80.notion.site/Headless-Fleet-Customer-Guide-397808527b1781018fc7d13a541d2efd).

## How it works

1. An administrator registers your OAuth provider in LangSmith.
2. An administrator adds the MCP server to a workspace and selects that provider.
3. Each person connects their account one time. The portal opens a popup for this step.
4. LangSmith keeps one token for each person. LangSmith refreshes the token when necessary.
5. When an agent uses a tool, LangSmith sends `Authorization: Bearer <token>` to the MCP server.
6. The MCP server examines the token. It finds the person from the token claims.

The portal and the agent never see the token. Only LangSmith and the MCP server see it.

The agent identity sets which token LangSmith sends:

| Agent identity | Token that LangSmith sends |
|---|---|
| Personal ("acts as you, with your own accounts") | The token of the person who runs the agent. |
| Shared ("uses the agent's connections") | The token that the owner connected to the agent. Not tested with this starter. |

## Before you start

- [ ] The MCP server uses the streamable HTTP transport.
- [ ] The MCP server accepts `Authorization: Bearer <access token>`. It examines the signature, `iss`, `aud` and `exp`. It sends HTTP 401 for a token that is not valid.
- [ ] Your OAuth provider supports the authorization code flow, PKCE (S256) and refresh tokens.
- [ ] LangSmith can connect to the MCP server URL and to the token URL of the provider. If one of them is on a private network, read [Private networks](#private-networks) first.
- [ ] The browser of each person can open the authorization URL of the provider.
- [ ] You have the Workspace Admin role in LangSmith.

## Step 1: Make an OAuth client in your provider

Make one confidential client for LangSmith. Set these values:

| Setting | Value |
|---|---|
| Flow | Authorization code |
| Client authentication | Client ID and client secret |
| PKCE | S256 |
| Redirect URI | `https://<langsmith-host>/host-oauth-callback/<provider-id>`. Use the exact value: HTTPS, no trailing slash. You select `<provider-id>` in step 2. |
| Refresh tokens | On |
| Access token audience | The value that the MCP server expects in `aud` |

### Keycloak

Tested with Keycloak 26.8.0. In your realm:

1. Go to **Clients** › **Create client**. Set **Client ID**, for example `langsmith-fleet`.
2. Set **Client authentication** to on. Keep **Standard flow**. Clear **Direct access grants**.
3. Set **Valid redirect URIs** to `https://<langsmith-host>/host-oauth-callback/keycloak-mcp`.
4. Go to **Advanced** › **Proof Key for Code Exchange Code Challenge Method**. Set it to `S256`.
5. Go to **Client scopes** › `<client-id>-dedicated` › **Configure a new mapper** › **Audience**.
   Set **Included Custom Audience** to the audience of the MCP server, for example `mcp-server`.
   Set **Add to access token** to on.
6. Go to **Credentials**. Copy the **Client secret**.

Each person must have the `offline_access` realm role. Keycloak gives this role to users
that you make in the admin console. Keycloak does not give it to users from an imported
realm file. If a user does not have the role, the connection fails (see
[Troubleshooting](#troubleshooting)).

The MCP server must accept `iss` = `https://<keycloak-host>/realms/<realm>`. Keycloak
writes the hostname of the request into `iss`. Set `KC_HOSTNAME` so that LangSmith and the
browsers get the same value.

### Microsoft Entra ID

Not tested end to end with this starter.

1. Make an app registration for the MCP server. Go to **Expose an API**. Add a scope, for
   example `MCP.Access`. In the manifest, set `"requestedAccessTokenVersion": 2`.
2. Make a second app registration for LangSmith. Add the **Web** redirect URI from the table above.
3. In the LangSmith app, add a client secret.
4. In the LangSmith app, add the delegated permission for `MCP.Access`.
5. Use this scope in step 2: `openid offline_access api://<mcp-app-id>/MCP.Access`.

With v2 tokens, the MCP server gets `iss` = `https://login.microsoftonline.com/<tenant-id>/v2.0`
and `aud` = `<mcp-app-id>`.

LangSmith uses special rules for every token URL on `login.microsoftonline.com`. LangSmith
does not send PKCE to that URL, and the client secret is necessary.

## Step 2: Register the OAuth provider in LangSmith

Go to **Settings** › **OAuth providers** › **OAuth Provider**. Set these fields:

| Field | Value | Keycloak example |
|---|---|---|
| Provider ID | A short ID. It is part of the redirect URI. | `keycloak-mcp` |
| Display Name | Any name | `Keycloak` |
| Client ID | From step 1 | `langsmith-fleet` |
| Client Secret | From step 1 | |
| Grant Type | Authorization Code | |
| Authorization URL | The authorization endpoint of the provider | `https://<keycloak-host>/realms/<realm>/protocol/openid-connect/auth` |
| Token URL | The token endpoint of the provider | `https://<keycloak-host>/realms/<realm>/protocol/openid-connect/token` |
| Enable PKCE | On. LangSmith shows only providers with PKCE when you add an MCP server. | |
| Advanced › Scope | The scopes for the token | `openid offline_access` |

Set the **Scope** field. The MCP server record in LangSmith has no scope field. The portal
and the agent runtime also send no scopes. Without this field, the provider gets no scope
from LangSmith.

LangSmith examines the two URLs when you save. LangSmith does not accept `localhost`. For
a private address, read [Private networks](#private-networks).

## Step 3: Add the MCP server to the workspace

1. Go to **Fleet** › **Integrations** › **+ Custom MCP**.
2. Set **Name**, for example `whoami`.
3. Set **URL** to the streamable HTTP endpoint, for example `https://mcp.example.com/mcp`.
4. Set **Authentication** to **OAuth 2.1 (Manual)**.
5. Select the provider from step 2.
6. Click **Save server**.

LangSmith keeps tool references by URL. If you change the URL later, agents that use the
server do not work. Then remove the tools from each agent and add them again.

## Step 4: Use the tools in the portal

To add the tools to an agent (builders):

1. Go to **Build** and open the agent.
2. Open **Tools** and select the MCP server. The portal shows that the server is not connected.
3. Click **Connect**. A popup opens the sign-in page of your provider.
4. Sign in. The popup goes to a LangSmith page and the connection completes.
5. Select the tools and click **Add**.

To use the agent (everyone):

1. Open the agent in **Use**.
2. If you do not have a connection, the portal shows **Connect before you start**. The
   message box stays off.
3. Click **Connect** and sign in. The message box comes on.

The connection stays valid while the provider lets LangSmith refresh the token. If the
provider stops the session, the refresh fails. Then the portal shows **Connect before you
start** again.

The popup completes on the LangSmith callback page. That page uses the LangSmith session
of the person in the same browser. Make sure that people can sign in to LangSmith with SSO.

## Private networks

Do this section only if the MCP server, or the token URL of the provider, has a private IP
address. Examples:

- a Kubernetes Service in the cluster where LangSmith runs
- an internal load balancer, or a private endpoint in your VNet or VPC
- a server in your data center that LangSmith gets to through a VPN

If both addresses are public, you do not need this section.

### Why it is necessary

LangSmith has SSRF protection. By default, LangSmith does not connect to private IP
addresses for MCP servers and OAuth providers. Then you see errors like
`URL blocked by SSRF policy` when you save the provider or the MCP server.

### What to set

Set `SSRF_ALLOW_PRIVATE_IPS_MCP_SERVERS=true` in your LangSmith Helm release. Four
LangSmith components read it. Each component reads it from its own environment:

| Component | Helm values path | What the setting lets the component do |
|---|---|---|
| platform-backend | `platformBackend.deployment.extraEnv` | Save the MCP server. List its tools. |
| host-backend | `hostBackend.deployment.extraEnv` | Save the provider URLs. Get and refresh tokens. |
| backend | `backend.deployment.extraEnv` | List the tools for agent runs and for the LangSmith UI. |
| Fleet api-server and queue | Nothing to set | The chart sets it for these components. |

Example, for chart 0.17.25:

```yaml
platformBackend:
  deployment:
    extraEnv:
      - name: SSRF_ALLOW_PRIVATE_IPS_MCP_SERVERS   # add to your current list
        value: "true"
hostBackend:
  deployment:
    extraEnv:
      - name: SSRF_ALLOW_PRIVATE_IPS_MCP_SERVERS
        value: "true"
backend:
  deployment:
    extraEnv:
      - name: SSRF_ALLOW_PRIVATE_IPS_MCP_SERVERS
        value: "true"
```

[`langsmith/values-fleet-oidc.yaml`](../langsmith/values-fleet-oidc.yaml) has the same
lines as comments. After `helm upgrade`, these three Deployments restart.

### Rules

- **Do not put the setting in `commonEnv`.** The chart sets the same variable on the Fleet
  pods. Then `helm upgrade` stops with `Duplicate keys detected`.
- **Copy your current entries into each list.** Helm replaces lists. It does not merge them.
- **Use the short Service name:** `http://<service>.<namespace>.svc:<port>/mcp`. Do not use
  `*.svc.cluster.local`. platform-backend does not accept that suffix, also with
  `SSRF_ALLOW_K8S_INTERNAL=true` (LangSmith 0.17.53).
- **Do not use `SSRF_ALLOW_PRIVATE_IPS_OAUTH_TOKEN` for this.** That setting is for model
  configurations only.
- **Use one hostname for the provider.** The authorization URL opens in the browser of each
  person. LangSmith uses the token URL from inside its network. Both must use the same
  hostname, so that `iss` is the same in every token. Internal DNS usually gives this result.
  [`examples/mcp-whoami/`](../examples/mcp-whoami/) shows a test setup with `/etc/hosts`
  and `kubectl port-forward`.

LangSmith continues to block `localhost` and cloud metadata addresses.

> **Warning:** Give the Workspace Admin role and the MCP server permissions only to
> trusted people. With this setting, these people can make LangSmith send requests to
> private addresses in your network.

## Troubleshooting

| What you see | Cause | Fix |
|---|---|---|
| The popup shows "Authentication failed. OAuth provider returned an error (HTTP 400)". | The provider did not accept the token request from LangSmith. LangSmith does not show the reason. | Read the logs of the provider. Keycloak writes a `CODE_TO_TOKEN_ERROR` event with the reason. |
| Keycloak logs "Offline tokens not allowed for the user or client". | The Scope has `offline_access`, but the user does not have the `offline_access` role. | Give the role to the user. Or remove `offline_access` from the Scope. |
| Entra shows `AADSTS70011` about `offline_access`. | The request has `offline_access` but no resource scope. | Set **Scope** to `openid offline_access api://<mcp-app-id>/<scope>`. |
| Save fails with `URL blocked by SSRF policy`. | The URL has a private IP address. | Do [Private networks](#private-networks). |
| Save fails with `hostname is a Kubernetes internal service`. | The URL ends with `.svc.cluster.local`. | Use `http://<service>.<namespace>.svc:<port>/mcp`. |
| The portal shows **Connect before you start** again. | The provider stopped the session, so the refresh failed. | Click **Connect** and sign in again. |
| The connection works, but the MCP server sends 401. | The `iss` or `aud` in the token is not the value that the MCP server expects. | Compare the claims in the token with the settings of the MCP server. |

## Tested with

- Keycloak 26.8.0 and the [`examples/mcp-whoami/`](../examples/mcp-whoami/) server, in the same AKS cluster as LangSmith.
- Self-hosted LangSmith chart 0.17.25 / app 0.17.53, with the private network settings above.
- Results:
  - the connection from the portal
  - the tool list
  - a tool call as the person
  - a refresh after the 5-minute token was no longer valid
  - the **Connect before you start** gate after Keycloak stopped the session
- Not tested: shared agents, Entra ID or Okta as the provider, MCP servers on public addresses.
