# Troubleshooting

Start with these two commands. Most problems show up in one of them.

```bash
helm test <release> -n <namespace> --logs              # LangSmith, identity provider, portal
kubectl logs -n <namespace> deploy/<release>-headless-fleet-portal
```

## The install or the pod

| What you see | Cause | Fix |
|---|---|---|
| `helm install` fails: "The portal needs N more value(s)" | Required values are missing or malformed. All of them are listed. | Fill in section 1 of your values file. |
| `helm install` fails: "additional properties 'x' not allowed" | A mistyped key in your values file. | Fix the key's spelling (compare with `values.yaml`). |
| The pod restarts, and its log says "cannot start: N configuration problems" | A setting the chart cannot check, such as a short `auth-secret`. | Fix the listed items, then `kubectl rollout restart deployment/<release>-headless-fleet-portal -n <namespace>`. |
| `CreateContainerConfigError` | The Secret named in `secrets.existingSecret` is missing, or lacks `oidc-client-secret` or `auth-secret`. | Create it in the release namespace, with both keys. |
| `ImagePullBackOff` | The cluster cannot pull `image.repository`. | Check the name and tag, and set `imagePullSecrets` for a private registry. |
| The log says `exec format error` | The image was built for another CPU (Apple silicon builds arm64). | Rebuild with `docker buildx build --platform linux/amd64 …`. |
| A certificate error in the browser | The TLS Secret for the host is missing or not yet issued. | With cert-manager, check `kubectl get certificate -n <namespace>`. |

## Signing in

| What you see | Cause | Fix |
|---|---|---|
| The IdP says the redirect URI is not registered | The portal's app is missing `<portal.url>/api/auth/callback/oidc`. | Add exactly that URI: https, same host, no trailing slash. `NOTES.txt` prints it after install. |
| "Sign-in refused. The access token is for X, but LangSmith expects Y." | The IdP issues tokens for another audience. | Set up the audience (docs/identity-provider.md, "Access tokens are JWTs for LangSmith"), or fix `oidc.audience` so it equals LangSmith's `FLEET_EXTERNAL_AUTH_OIDC_AUDIENCE`. |
| "Sign-in refused. The access token was issued by X…" | The issuer differs, often by a trailing slash, or an Entra v1 token (`sts.windows.net`). | Make `oidc.issuer`, the discovery document and LangSmith's `FLEET_EXTERNAL_AUTH_OIDC_ISSUER_URL` identical. On Entra, set `requestedAccessTokenVersion: 2` (older manifest: `accessTokenAcceptedVersion`) on LangSmith's app. |
| "Sign-in refused. The access token has no "oid" claim" | Wrong `oidc.subjectClaim` for this IdP. | `oid` on Entra ID, usually `sub` elsewhere (`uid` on Okta custom servers). |
| "…can't read (not a JWT)" | The IdP issues opaque access tokens. | Use an IdP or authorization server that issues JWT access tokens for an API. |
| "did not issue a refresh token" | `offline_access` is not allowed for the portal's app. | Allow refresh tokens / offline access. |
| After sign-in: "Your account isn't set up in LangSmith yet" | LangSmith has no user with that subject, or the user has no workspace. | Have the person sign in to LangSmith once, or create them with SCIM (`externalId` = subject). See [langsmith.md](langsmith.md). |
| Sign-in loops back to the login page | `portal.url` is http but the site is served over https, or the other way round, so the session cookie is not sent back. | Make `portal.url` exactly the address in the browser. |

## Using the portal

| What you see | Cause | Fix |
|---|---|---|
| Every save fails with "cross-origin request refused" (403) | The browser's address differs from `portal.url` (another host, port or scheme). | Set `portal.url` to the address people actually use. |
| Build and Publish are missing for everyone | `roles.builders` is empty: Build is off. | Set it to role values your IdP issues. |
| Build is missing for one person | Their id_token has no matching role at `roles.claim`. | Check the claim path (`realm_access.roles` on Keycloak, `groups` on Okta) and their role assignment. |
| A chat answer stops in the middle | A proxy closed the stream or buffered it. | The portal sends a keep-alive every 15 s. Check for a proxy with a read timeout under 20 s, or one that buffers `text/event-stream`. The run itself continues in LangSmith, and reloading the conversation shows the result. |
| A skill upload fails with 413 | The ingress refuses large request bodies (ingress-nginx allows 1 MB). | Raise the limit to 8 MB, e.g. `nginx.ingress.kubernetes.io/proxy-body-size: "8m"`. |
| The Activity drawer shows only some calls | More than one replica: each pod keeps its own log. | Keep `replicaCount: 1`. |
| "Your sign-in expired. Sign in again." soon after signing in | The refresh failed. Some IdPs revoke a refresh token once it is used, and several replicas raced. | Keep `replicaCount: 1`. The pod log shows the IdP's error code. |

## Tools from your own MCP server

See the table in [mcp-servers.md](mcp-servers.md#troubleshooting). The most frequent
problems:

| What you see | Cause | Fix |
|---|---|---|
| The Connect popup shows "OAuth provider returned an error (HTTP 400)". | The provider did not accept the token request. LangSmith does not show the reason. | Read the logs of the provider. |
| Saving the MCP server or the provider fails with `URL blocked by SSRF policy`. | The URL has a private IP address. | Set the [private network settings](mcp-servers.md#private-networks). |
| **Connect before you start** shows again for an account that was connected. | The provider stopped the session, so the refresh failed. | Connect again. |
