# Prepare LangSmith

The portal has no database and no admin console. Everything it shows comes from LangSmith,
called as the signed-in person. This page covers what your LangSmith install needs for that.

## Requirements

- **Self-hosted LangSmith 0.17 or later.** Tested on chart 0.17.6 / app 0.17.33, and on chart 0.17.25 / app 0.17.53.
  - Per-user sign-in for Fleet exists only on self-hosted installs. LangSmith Cloud
    (SaaS) does not offer it, so the portal cannot act as each person there. Dev mode
    still works against SaaS with one API key, for UI work.
  - Earlier versions have not been tested.
- **An Enterprise license** with the Fleet entitlement.
- **Fleet enabled**, with its tool server, trigger server and host backend. The host backend
  serves OAuth tool connections.
- **LangSmith SSO through OIDC, using the same identity provider as the portal.** This is
  how LangSmith knows each user (below).

## Turn on per-user sign-in for Fleet

LangChain documents these settings in the [Headless Fleet Customer Guide](https://mirror-feeling-d80.notion.site/Headless-Fleet-Customer-Guide-397808527b1781018fc7d13a541d2efd), on its
[Identity & SSO with OIDC](https://mirror-feeling-d80.notion.site/Identity-SSO-with-OIDC-397808527b1781a29a15ebcd4f4d4b90) page. This section and
[`langsmith/values-fleet-oidc.yaml`](../langsmith/values-fleet-oidc.yaml) follow it.

Add the values of [`langsmith/values-fleet-oidc.yaml`](../langsmith/values-fleet-oidc.yaml)
to your LangSmith release. If you manage LangSmith with a different tool (for example Argo CD
or Terraform), add the values in that tool. Otherwise, do these steps from the root of this
repo:

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

4. Compare the two files. Helm **replaces lists**. It does not merge them. If
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

Each later LangSmith upgrade must also use `my-values-langsmith-fleet.yaml`. The two
`my-values-*.yaml` files are in `.gitignore`.

Three values there must equal the portal's values exactly:

| LangSmith (`platformBackend` env) | Portal chart | Notes |
|---|---|---|
| `FLEET_EXTERNAL_AUTH_OIDC_ISSUER_URL` | `oidc.issuer` | Compared byte for byte, so watch trailing slashes. `helm test` on the portal checks it against the discovery document. |
| `FLEET_EXTERNAL_AUTH_OIDC_AUDIENCE` | `oidc.audience` | One value. The token's `aud` may be a list that contains it. |
| `FLEET_EXTERNAL_AUTH_OIDC_SUBJECT_CLAIM` | `oidc.subjectClaim` | `oid` on Entra ID, usually `sub` elsewhere. |

Leave `FLEET_EXTERNAL_AUTH_PROVIDER` at its default, `custom-oidc`. That is the value tested
on LangSmith 0.17.

## Users must already exist in LangSmith

LangSmith never creates a user from a portal token. It looks up the token's subject among
the users it already knows. **Someone LangSmith has not set up gets a 403**, and the portal
shows "Your account isn't set up in LangSmith yet."

There are three ways to set people up:

- **Each person signs in to LangSmith once** through SSO. LangSmith records their subject
  and puts them in your SSO default workspaces. This is the simplest way, and it is how
  most installs start.
- **Manually.** Create the user in LangSmith and set their external id to the value of the
  subject claim in their token (with Entra ID, their `oid`). The
  [guide's user provisioning section](https://mirror-feeling-d80.notion.site/Identity-SSO-with-OIDC-397808527b1781a29a15ebcd4f4d4b90) shows how to read it from a token.
- **SCIM, for many people at once.** Create each user with `externalId` set to the value of
  the subject claim, for example the Entra object id. Also add them to a group that grants
  a workspace: a user with no workspace is refused too. SCIM needs LangSmith's OIDC SSO
  mode. See LangSmith's SCIM documentation for the group naming.

Whichever you use, the subject LangSmith stored must equal the subject claim in the access token.
With Entra ID that is `oid` on both sides.

## Workspaces

The portal sends a workspace with every call (`X-Tenant-Id`). It lists only the workspaces
LangSmith returns for the signed-in person, and offers a switcher when there are several.
To limit models or skills to one audience, give that audience its own workspace: see
[governance.md](governance.md).

## Optional

- **Computer (LangSmith Sandboxes).** Enable it as LangSmith's self-hosting docs describe for
  your cloud. The portal finds it through Fleet, with no portal setting.
- **Faster governance changes.** The cache settings in the values file make ABAC and tag
  changes show up in about 30 seconds instead of up to an hour.
- **Your own MCP servers.** To give agents tools from an MCP server behind your own OAuth
  provider, see [mcp-servers.md](mcp-servers.md). If that server or its provider has a
  private IP address, LangSmith needs one more setting on three components:
  [Private networks](mcp-servers.md#private-networks).

## Check it

After installing the portal, run:

```bash
helm test <release> -n <namespace> --logs
```

It checks that LangSmith answers and is 0.17 or later, and that the issuer matches the
discovery document exactly. Then sign in. If the sign-in is refused, the login page says
why: see [troubleshooting.md](troubleshooting.md).
