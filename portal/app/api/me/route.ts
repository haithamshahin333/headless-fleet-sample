import { config as appConfig } from "@/lib/config"
import { config, route, selectedWorkspace } from "@/lib/fleet/server"

/** Who the portal thinks you are, which workspaces LangSmith says you belong to. */
export const GET = route({ workspace: false }, async ({ user }) => {
  const { current, all } = await selectedWorkspace(user)
  return {
    name: user.name,
    email: user.email,
    roles: user.roles,
    can_build: user.can_build,
    build_enabled: appConfig.builderRoles.length > 0,
    is_admin: user.is_admin,
    dev: user.dev,
    workspaces: all,
    current_workspace: current,
    langsmith_ui: user.is_admin ? (config.langsmithUi ?? null) : null,
  }
})
