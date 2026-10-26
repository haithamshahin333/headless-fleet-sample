# Govern the portal from LangSmith

The portal has **no policy engine and no admin console**. A platform team configures
governance once, in LangSmith. The portal then shows each signed-in person exactly what
LangSmith allows *them*, because every Fleet call is made as that person (their own access
token from your identity provider → their LangSmith user).

The same rules therefore hold in the portal, in the Fleet UI, and on the API.

Everything below is a LangSmith click path except **one** step: ABAC access policies,
which the docs say are configurable via the API (roles and resource tags have UI).
That step is given as Terraform plus a curl equivalent.

## What you can govern, and where

| Want to control | Native lever | Where (LangSmith) | What the portal user sees |
|---|---|---|---|
| Who can use the platform, and which group they're in | Workspace membership + workspace role (SCIM / group sync from your identity provider) | Settings › Members | Only their workspaces in the switcher |
| **Which models** | Per workspace: Settings › Model configurations › **Feature access** → enable for Fleet. Org-scoped configs need chart ≥ 0.17.0-rc.42 | Settings › Model configurations | The model picker lists only enabled models. An agent pinned to a disabled model fails with "That model isn't enabled for Fleet in this workspace" (Fleet returns 422 at create and on run overrides) |
| **Which tools**, coarse | Built-in integrations on/off for the workspace | Settings › Integrations › Access control | Disabled integrations disappear |
| **Which tools**, by role | Custom role with `mcp-servers:read` + `mcp-servers:invoke` (no create/update/delete) | Settings › Roles | Can use, can't register or modify tool servers |
| **Which tools**, per integration and per role | **ABAC**: tag the integration, then a deny (or allow) policy for the role | Tags: Settings › Resource tags. **Policy: API/Terraform (below)** | The integration is missing or locked: "🔒 restricted by admin" |
| **Which skills** | Workspace skills (per workspace) | Fleet › Skills, or the portal's Build › Skills | Only that workspace's skills. Builders add to the library too (see below) |
| **Computer** | Sandbox access profiles (egress + injected credentials); snapshots | Fleet › Computer | Only permitted profiles and boot images |
| **Spend** | Weekly USD cap per user and per agent | Fleet › Usage (Workspace Admin) | The run is refused with "weekly spend cap reached" |
| **Sharing** | The owner sets visibility, workspace level and per-person level | Portal › Publish, *or* Fleet UI | "Shared with you", Run/Clone/Edit badges |
| **Oversight** | Tool approval (`interrupt_config`), traces, audit logs | Agent config; LangSmith tracing / audit | The approval gate in chat |

## Per-user models and skills: use workspaces

Within one workspace, LangSmith has **no per-user model or skill control**. Model
availability, `disabled-models`, and org-level provider bans are all workspace- or
org-wide.

The native pattern is **one workspace per audience**, e.g. `engineering` and `sales`:

1. Create the workspaces, and put each group from your identity provider in the right one
   with the right role.
2. In each workspace, enable only that audience's models for Fleet (Feature access), and
   keep only that audience's skills and workspace secrets there. Members can add skills
   too, so review a workspace's library rather than assuming only you fill it.
3. Publish agents into the workspace they belong to.

The portal's workspace switcher lists only the caller's own workspaces.

## The one API step: an ABAC policy on a tool

This example hides one built-in integration from a "runner" role. ABAC applies to
interactive, per-user runs. **Service identities and shared-credential agents bypass
ABAC** (only the workspace integration policy applies to them).

```hcl
# terraform-provider-langsmith (see docs: langsmith/manage-with-terraform)
resource "langsmith_tag" "restricted" {
  key   = "tool-tier"
  value = "restricted"
}

resource "langsmith_tagging" "gmail_restricted" {
  tag_value_id  = langsmith_tag.restricted.tag_value_id
  resource_type = "fleet_integration"
  resource_id   = "<Gmail integration id from GET /v1/fleet/integrations>"
}

resource "langsmith_workspace_role" "agent_runner" {
  display_name = "Agent Runner"
  description  = "Run shared agents and use tools; no admin surfaces"
  permissions  = ["mcp-servers:read", "mcp-servers:invoke", "runs:create", "runs:read", "projects:read", "prompts:read"]
}

resource "langsmith_access_policy" "deny_restricted_tools" {
  name   = "Runners: no restricted tools"
  effect = "deny"
  condition_groups = [{
    permission    = "mcp-servers:read"
    resource_type = "fleet_integration"
    conditions = [{
      attribute_name  = "resource_tag_key"
      attribute_key   = "tool-tier"
      operator        = "equals"
      attribute_value = "restricted"
    }]
  }]
}

resource "langsmith_access_policy_attachment" "runner_deny" {
  role_id          = langsmith_workspace_role.agent_runner.id
  access_policy_id = langsmith_access_policy.deny_restricted_tools.id
}
```

curl equivalent for the policy (admin API key, `organization:manage`):

```bash
curl -X POST "$LANGSMITH_HOST/api/v1/platform/orgs/current/access-policies" \
  -H "X-Api-Key: $LANGSMITH_ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Runners: no restricted tools","effect":"deny",
       "condition_groups":[{"permission":"mcp-servers:read","resource_type":"fleet_integration",
         "conditions":[{"attribute_name":"resource_tag_key","attribute_key":"tool-tier",
                        "operator":"equals","attribute_value":"restricted"}]}],
       "role_ids":["<agent runner role id>"]}'
```

This payload shape has been run against LangSmith 0.17. Assign the role to the consumer group in Settings › Members. From then on, adding or
removing the `tool-tier=restricted` tag on any integration, in the UI, is the live
on/off switch.

**Propagation:** ABAC caches default to an hour. The values in
[`langsmith/values-fleet-oidc.yaml`](../langsmith/values-fleet-oidc.yaml) set them to about
30 seconds, so a change shows up in the portal within half a minute.

## On-behalf-of tool connections

Agents created with **"Each user's own accounts"** use the *runner's* own connection for
each provider. The portal checks this before the first message and offers Connect. For
Microsoft tools, register your own Entra app as the OAuth provider and **grant admin
consent**, so the popup completes silently on the user's existing Entra session (see
[identity-provider.md](identity-provider.md#microsoft-365-tools-optional)).

Agents created with **"The agent's own"** connections use a connection bound to the
agent. Only its owner or an editor can bind it.

## What LangSmith did not enforce in testing (said plainly in the portal)

Tested on self-hosted LangSmith 0.17 (0.17.33). Later 0.17 releases add Fleet RBAC (see
"Enable Fleet RBAC on self-hosted" in the LangSmith docs), which can enforce the first and
third items below. This starter has not been tested with it.

- **Who may build agents.** LangSmith did not check `fleet-agents:create`. The portal hides
  Build and Publish unless the user has one of the `roles.builders` roles from your identity
  provider. That is UX gating only.
- **Per-user model or skill choice inside one workspace.** Use workspaces (above).
- **Who may create skills.** LangSmith did not check `fleet-skills:create`, so any workspace
  member could create a workspace skill. The portal offers skill creation only to
  `roles.builders` (UX gating). Only a skill's creator can change or delete it.
- **An admin kill-switch on publishing.** Sharing is owner-controlled. Audit it in the
  agent list (`visibility`, `shared_users`).
- **Per-tool (rather than per-integration) restriction.** ABAC targets integrations.
  To split read from write, register a narrower custom MCP server and restrict the
  built-in one.
