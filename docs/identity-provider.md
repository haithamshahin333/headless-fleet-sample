# Set up your identity provider

The portal signs people in with your identity provider (IdP) over OpenID Connect, then calls
LangSmith with **each person's own access token**. LangSmith checks that token itself. This
page covers what the IdP has to provide, then the settings for Entra ID (tested), Keycloak,
Okta and Auth0 (not yet tested with this portal).

## What any provider must do

| # | Requirement | Why |
|---|---|---|
| 1 | **LangSmith's own SSO uses this same provider** (OIDC). | LangSmith finds the user by the subject it stored when they signed in to LangSmith, or when SCIM created them. |
| 2 | **An app (client) for the portal**: confidential, authorization-code flow, a client secret, and the redirect URI `<portal.url>/api/auth/callback/oidc`. | The portal signs people in with it. |
| 3 | **Access tokens are JWTs for LangSmith**: `aud` contains the LangSmith audience, `iss` is exactly the issuer, signed with RSA, RSA-PSS, ECDSA or EdDSA (not HMAC). | LangSmith verifies the token itself. Google, for example, issues opaque access tokens and cannot be used. |
| 4 | **The subject claim in the access token** (`sub`, or `oid` on Entra) holds the same value LangSmith stored for the user. | That is how LangSmith picks the user. |
| 5 | **Refresh tokens** (`offline_access`). | Access tokens last about an hour; the portal refreshes them on the server. |
| 6 | **Roles or groups in the id_token** (optional). | The portal shows Build and Publish to `roles.builders`. LangSmith ignores these: they are UX only. |

The portal checks 3 and 4 at every sign-in. If the token would be refused, the login page
says exactly why (for example "the access token is for `account`, but LangSmith expects
`langsmith`"). You get that sentence instead of a 401 on every page.

Whatever you choose here also goes into LangSmith. See [langsmith.md](langsmith.md) and
the table at the top of `langsmith/values-fleet-oidc.yaml`.

---

## Microsoft Entra ID

**Tested** against self-hosted LangSmith 0.17.

You need two app registrations in one tenant. Do the sections in this order:
- **Section 1: one new app for the portal.** Section 2 needs its client ID.
- **Section 2: LangSmith's SSO app.** You already have it if LangSmith uses Entra SSO. It
  is also the API that the tokens of the portal are for. You must own it, or have an admin
  role that can change it.

### 1. The portal's app

| Setting | Value |
|---|---|
| Supported account types | Single tenant |
| Platform | Web, redirect URI `<portal.url>/api/auth/callback/oidc` |
| Certificates & secrets | a client secret, which goes in the `oidc-client-secret` key of your Secret |
| API permissions | nothing to add. The portal asks for `openid profile email offline_access api://<langsmith-app-client-id>/Fleet.Access`. |

Write down the **Application (client) ID** of this app. Section 2 needs it.

**App roles** (what the portal shows each person). Allowed member types: Users/Groups.

| Display name | Value | Effect in the portal |
|---|---|---|
| Platform team | `Portal.Platform` | Build and Publish, plus the "Admin in LangSmith" link |
| Agent builders | `Portal.Builder` | Build and Publish |
| Agent users | `Portal.Consumer` | Use only |

Then in **Enterprise applications › (the portal)**:
- Set **Assignment required** to Yes.
- Assign groups to the roles. To assign groups, you need Entra ID P1 or P2. On the free
  tier, assign users one by one.

The roles arrive in the id_token's `roles` claim.

### 2. LangSmith's app exposes an API

On **LangSmith's** app registration:

| Setting | Value |
|---|---|
| Expose an API › Application ID URI | `api://<langsmith-app-client-id>` |
| Expose an API › Add a scope | `Fleet.Access` (admins and users, enabled) |
| Manifest | `"requestedAccessTokenVersion": 2` (called `accessTokenAcceptedVersion` in the older manifest format). Then `iss` is `https://login.microsoftonline.com/<tenant-id>/v2.0` and `aud` is the app's client ID. A v1 token (`iss` = `https://sts.windows.net/…`) is refused. |
| Expose an API › Authorized client applications | the **portal's** client ID from section 1, with `Fleet.Access`. This pre-authorizes the portal, so users see no consent prompt. |

Pre-authorize only the portal. Any pre-authorized client can get a LangSmith token for whoever
signs in to it, so do not add general tools such as the Azure CLI.

<details>
<summary>Doing it with the Azure CLI</summary>

Microsoft Graph replaces the whole `api` object on PATCH. Read it first, add the client, then write it back:

```bash
APP=<langsmith app object id>; PORTAL=<portal client id>
G="https://graph.microsoft.com/v1.0/applications/$APP"
az rest --method GET --url "$G" --query api > api.json
SCOPE_ID="$(jq -r '.oauth2PermissionScopes[] | select(.value == "Fleet.Access") | .id' api.json)"
jq --arg c "$PORTAL" --arg s "$SCOPE_ID" \
  '{api: (.preAuthorizedApplications += [{appId: $c, delegatedPermissionIds: [$s]}])}' api.json > patch.json
az rest --method PATCH --url "$G" --headers Content-Type=application/json --body @patch.json
```
</details>

### 3. Values

| Portal chart value | Value |
|---|---|
| `oidc.issuer` | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
| `oidc.clientId` | the portal app's client ID |
| `oidc.audience` | **LangSmith's** app client ID |
| `oidc.apiScope` | `api://<langsmith-app-client-id>/Fleet.Access` |
| `oidc.subjectClaim` | `oid`. Entra's `sub` is different for every app, and LangSmith stores `oid`. |
| `roles.claim` / `roles.builders` / `roles.admins` | `roles` / `[Portal.Builder, Portal.Platform]` / `[Portal.Platform]` |

On LangSmith, `FLEET_EXTERNAL_AUTH_OIDC_AUDIENCE` is LangSmith's app client ID and
`FLEET_EXTERNAL_AUTH_OIDC_SUBJECT_CLAIM` is `oid`.

Start from `chart/headless-fleet-portal/examples/values-entra.yaml`.

### Microsoft 365 tools (optional)

Tools such as Outlook and OneDrive act **on behalf of** the person using the agent. The
portal opens a consent popup to create that person's connection.

To make the popup complete without a prompt:
1. Register an Entra app as the OAuth provider in LangSmith. The bundled provider does not
   work through the self-hosted callback path.
2. Give it the delegated Graph permissions the tools need.
3. **Grant admin consent.**

The person is already signed in to Entra, so the popup closes by itself.

For tools from an MCP server that you operate, see [mcp-servers.md](mcp-servers.md).

---

## Keycloak

**Not yet tested with this portal.** LangSmith's per-user sign-in has been run with Keycloak.

1. **Fix the hostname.** Keycloak writes into `iss` whatever URL the client used to reach it.
   Set `KC_HOSTNAME` (the frontend URL) so browsers, the portal and LangSmith all see the same
   issuer, `https://<keycloak-host>/realms/<realm>`.
2. **Client for the portal:**
   - confidential (client authentication on)
   - standard flow
   - redirect URI `<portal.url>/api/auth/callback/oidc`
3. **Audience.** Keycloak access tokens carry `aud: account` by default. Create a client
   scope with an **Audience** mapper that adds your LangSmith audience (for example
   LangSmith's client ID) to the access token. Add that scope to the portal client as a
   default scope. Use the same value for `oidc.audience` and LangSmith's
   `FLEET_EXTERNAL_AUTH_OIDC_AUDIENCE`.
4. **Roles.** Create realm roles such as `portal-builder` and `portal-platform`. In the
   `roles` client scope, turn on **Add to ID token** for the realm roles mapper. Then use
   `roles.claim: realm_access.roles`.
5. **Refresh tokens.** If the realm has **Revoke Refresh Token** turned on, keep
   `replicaCount: 1`.

Subject claim: `sub`. Start from `examples/values-keycloak.yaml`.

---

## Okta

**Not yet tested.**

1. Use a **custom authorization server** (API Access Management). Access tokens from Okta's
   org server are not meant for other APIs.
   - Its issuer is `https://<org>.okta.com/oauth2/<authorization-server-id>`.
   - Its **Audience** setting is your LangSmith audience.
   - LangSmith's SSO should sign in through the same authorization server.
2. **App for the portal:**
   - an OIDC Web Application
   - grant types: authorization code and refresh token
   - sign-in redirect URI `<portal.url>/api/auth/callback/oidc`
3. **Subject: check this one carefully.** In a custom server's access tokens, `sub` is the
   user's **login** (usually an email address), while `uid` is the user id. LangSmith's SSO
   stores the id from the id_token, which is the user id. So either:
   - set `oidc.subjectClaim` and LangSmith's `FLEET_EXTERNAL_AUTH_OIDC_SUBJECT_CLAIM` to `uid`, or
   - change the access token's `sub` to the user id.
4. **Groups.** Add a `groups` claim to the ID token, with a filter for your portal groups.
   Then use `roles.claim: groups`.

Start from `examples/values-okta.yaml`.

---

## Auth0

**Not yet tested.**

1. Create an **API** whose identifier is your LangSmith audience. Turn on **Allow Offline
   Access** so refresh tokens are issued. Use RS256.
2. Create a **Regular Web Application** for the portal, with the callback URL
   `<portal.url>/api/auth/callback/oidc`.
3. Set `oidc.audienceParam` to the API identifier: the portal sends it as `audience` when the
   person signs in. Set `oidc.audience` to the same value.
   - The token's `aud` is then a list: the API plus Auth0's `/userinfo`. LangSmith accepts a
     list that contains its audience.
4. **Roles.** Add them to the ID token with an Action as a custom claim whose name has no
   dots, for example `portal_roles`, and set `roles.claim: portal_roles`.

Subject claim: `sub`.
