import { z } from "zod"

import { attachSkill, createSkill, listSkillsFor } from "@/lib/fleet/ops"
import { explainText, PortalError, readJsonCapped, route, uuid } from "@/lib/fleet/server"
import { readFrontMatter } from "@/lib/skills/frontmatter"
import { bundleProblem, fleetSkillBody, isSkillName, MAX_FLEET_BODY, SKILL_MD, utf8Bytes } from "@/lib/skills/rules"

/** The workspace skill library, with `mine` = whether the caller owns each (null = can't tell). */
export const GET = route({}, async ({ fleet }) => listSkillsFor(fleet))

const MAX_REQUEST = 6_000_000
const Body = z.object({
  name: z.string().refine(isSkillName, "must be lowercase words joined by hyphens, 64 characters at most"),
  files: z.record(z.string(), z.string()),
  attach_to: z.string().optional(),
})

/**
 * Create a WORKSPACE skill from a `{path: text}` map, optionally linking it to an agent.
 * The browser already unpacked and checked the upload; nothing it sends is trusted, so every
 * rule is checked again here. The server never sees an archive.
 */
export const POST = route({ mutate: true, builder: true }, async ({ req, fleet }) => {
  const { name, files, attach_to } = Body.parse(await readJsonCapped(req, MAX_REQUEST))
  const agentId = attach_to ? uuid(attach_to, "agent id") : null
  const problem = bundleProblem(files)
  if (problem) throw new PortalError(400, problem)
  // Fleet accepts any SKILL.md, then the runtime silently skips one it cannot use.
  const fm = readFrontMatter(files[SKILL_MD])
  if (fm.name !== name || !fm.description) throw new PortalError(400, `SKILL.md front matter must have name: ${name} and a description.`)
  if (utf8Bytes(JSON.stringify(fleetSkillBody(name, files))) > MAX_FLEET_BODY) {
    throw new PortalError(413, "Too large for LangSmith once encoded (5 MiB per skill). Remove some files.")
  }

  const skill = await createSkill(fleet, name, files)
  const handle = String(skill.id ?? name)
  const out = {
    skill: { id: handle, name: (skill.name as string | undefined) ?? handle, description: (skill.description as string | undefined) ?? "" },
    attached: false,
    agent: null as unknown,
    attach_error: null as string | null,
  }
  if (agentId) {
    // A failed link keeps the skill: it is in the library, and the user is told it was not added.
    try {
      out.agent = await attachSkill(fleet, agentId, handle)
      out.attached = true
    } catch (err) {
      out.attach_error = explainText(err)
    }
  }
  return out
})
