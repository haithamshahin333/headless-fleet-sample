import { deleteSkill } from "@/lib/fleet/ops"
import { route, skillHandle } from "@/lib/fleet/server"

/**
 * Delete a workspace skill. LangSmith allows only its creator. Unlinking it from agents is
 * the caller's next step (the Build › Skills dialog does it for agents they can edit).
 */
export const DELETE = route<{ handle: string }>({ mutate: true, builder: true }, async ({ fleet, params }) => {
  await deleteSkill(fleet, skillHandle(decodeURIComponent(params.handle)))
  return { ok: true }
})
