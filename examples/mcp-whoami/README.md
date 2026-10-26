# Example: an MCP server behind Keycloak

This example deploys two things in the namespace `mcp-test`:

- **Keycloak 26.8.0** with the realm `mcp-test`. The realm has the client `langsmith-fleet` for LangSmith, a client `mcp-smoke` for a check, and two users, `alice` and `bob`.
- **whoami**, an MCP server with one tool. The tool tells you which Keycloak user the token belongs to.

Use it to test [docs/mcp-servers.md](../../docs/mcp-servers.md) before you connect your own MCP server.

> **Caution:** This example is for a test only. Keycloak runs in dev mode over HTTP. Its
> data is lost when the pod is replaced. Do not use it for production.

## What the MCP server does

[`server/server.py`](server/server.py) uses the MCP Python SDK 2.3.0. For each request, it:

1. Gets the signing key from the JWKS of the realm.
2. Examines the signature (RS256 only), `iss`, `aud` (`mcp-server`), `exp`, `iat` and `sub`.
3. Sends HTTP 401 if the token is not valid.

The `whoami` tool returns the username, the subject, the client, the audience, the scopes
and the time until the token is no longer valid. The server does not log or return the token.

## Before you start

- [ ] Self-hosted LangSmith in a Kubernetes cluster, and `kubectl` access to that cluster.
- [ ] The private network settings in your LangSmith release. The MCP server and Keycloak have private addresses in this example. See [Private networks](../../docs/mcp-servers.md#private-networks).
- [ ] A container registry that the cluster can pull from, and Docker with `buildx`.
- [ ] The Workspace Admin role in LangSmith.
- [ ] Administrator rights on your computer, to add one line to `/etc/hosts`.

## Deploy

1. Build the image and push it to your registry:

   ```bash
   docker buildx build --platform linux/amd64 -t <registry>/mcp-whoami:0.1.0 --push server
   ```

2. Make the namespace and the Secret. The values are random. Nothing shows them.

   ```bash
   kubectl create namespace mcp-test
   kubectl create secret generic keycloak-secrets -n mcp-test \
     --from-literal=admin-password="$(openssl rand -hex 24)" \
     --from-literal=fleet-client-secret="$(openssl rand -hex 24)" \
     --from-literal=smoke-client-secret="$(openssl rand -hex 24)" \
     --from-literal=alice-password="$(openssl rand -hex 24)" \
     --from-literal=bob-password="$(openssl rand -hex 24)"
   ```

3. Load the realm:

   ```bash
   kubectl create configmap keycloak-realm -n mcp-test --from-file=realm.json
   ```

4. Deploy Keycloak and the MCP server. Replace the two values in the `sed` command:

   ```bash
   sed -e 's#<langsmith-host>#langsmith.example.com#' -e 's#<registry>#registry.example.com#' k8s.yaml \
     | kubectl apply -f -
   kubectl rollout status deploy/mcp -n mcp-test
   kubectl rollout status deploy/keycloak -n mcp-test --timeout=600s
   ```

5. Do the check in the cluster. This check does not use LangSmith.

   ```bash
   kubectl apply -f smoke-job.yaml
   kubectl wait --for=condition=complete job/smoke -n mcp-test --timeout=120s
   kubectl logs job/smoke -n mcp-test
   ```

   You get this result:

   ```text
   keycloak token: ok
   tools/list without a token: HTTP 401 (want 401)
   tools/list with a bad token: HTTP 401 (want 401)
   whoami with the token:
   {... "username": "service-account-mcp-smoke" ... "audience": ["mcp-server", "account"] ...}
   ```

## Let your browser get to Keycloak

Your browser opens the sign-in page of Keycloak. LangSmith gets tokens from Keycloak inside
the cluster. Both must use the hostname `keycloak.mcp-test.svc`, so that `iss` is the same.

1. Add this line to `/etc/hosts` on your computer:

   ```bash
   echo '127.0.0.1 keycloak.mcp-test.svc' | sudo tee -a /etc/hosts
   ```

2. Start a port-forward. Keep it open during the test:

   ```bash
   kubectl port-forward -n mcp-test svc/keycloak 8080:8080
   ```

3. Open `http://keycloak.mcp-test.svc:8080/realms/mcp-test/.well-known/openid-configuration`.
   Make sure that `issuer` is `http://keycloak.mcp-test.svc:8080/realms/mcp-test`.

If Keycloak restarts, start the port-forward again.

## Register Keycloak and the MCP server in LangSmith

Do steps 2 and 3 of [docs/mcp-servers.md](../../docs/mcp-servers.md) with these values:

| Field | Value |
|---|---|
| Provider ID | `keycloak-mcp` |
| Client ID | `langsmith-fleet` |
| Client Secret | Copy it with the command below. |
| Grant Type | Authorization Code |
| Authorization URL | `http://keycloak.mcp-test.svc:8080/realms/mcp-test/protocol/openid-connect/auth` |
| Token URL | `http://keycloak.mcp-test.svc:8080/realms/mcp-test/protocol/openid-connect/token` |
| Enable PKCE | On |
| Advanced › Scope | `openid offline_access` |
| MCP server URL | `http://mcp.mcp-test.svc:8000/mcp` |
| MCP server Authentication | OAuth 2.1 (Manual), provider `keycloak-mcp` |

To copy the client secret on macOS (on Linux, use `xclip` in place of `pbcopy`):

```bash
kubectl get secret keycloak-secrets -n mcp-test -o jsonpath='{.data.fleet-client-secret}' | base64 -d | pbcopy
```

## Test in the portal

1. Do step 4 of [docs/mcp-servers.md](../../docs/mcp-servers.md). Make a personal agent with the `whoami` tool.
2. When Keycloak asks, sign in as `alice`. Copy the password with this command:

   ```bash
   kubectl get secret keycloak-secrets -n mcp-test -o jsonpath='{.data.alice-password}' | base64 -d | pbcopy
   ```

3. Send this message to the agent: "Call whoami and tell me exactly what it returned."
   The answer has `"username": "alice"`.
4. Look at the server log. It has the line `whoami user=alice client=langsmith-fleet`:

   ```bash
   kubectl logs deploy/mcp -n mcp-test
   ```

5. To test the refresh, wait 6 minutes. Then send the message again. The answer still has
   `alice`, and `expires_in_seconds` is close to 300.

### Optional: test the connection gate

Stop the sessions of `alice` in Keycloak. This also cancels her refresh token:

```bash
kubectl exec -n mcp-test deploy/keycloak -- bash -c '
KC=/opt/keycloak/bin/kcadm.sh; CFG=(--config /tmp/kcadm.config)
$KC config credentials "${CFG[@]}" --server http://localhost:8080 --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null 2>&1
ID=$($KC get users -r mcp-test -q username=alice -q exact=true --fields id --format csv --noquotes "${CFG[@]}")
$KC create users/$ID/logout -r mcp-test "${CFG[@]}"
$KC delete users/$ID/consents/langsmith-fleet -r mcp-test "${CFG[@]}" 2>/dev/null
rm -f /tmp/kcadm.config'
```

Wait 6 minutes, so that the last access token is no longer valid. Then open the agent in
the portal again. The portal shows **Connect before you start**, and the message box is off.
Connect again as `bob`. Now `whoami` returns `bob`.

## Remove

1. Delete the namespace:

   ```bash
   kubectl delete namespace mcp-test
   ```

2. In LangSmith, delete the MCP server and the OAuth provider `keycloak-mcp`.
3. Remove the `keycloak.mcp-test.svc` line from `/etc/hosts`.
4. Delete the image `mcp-whoami` from your registry.
5. If no other MCP server or provider has a private address, remove the private network settings from your LangSmith release.
