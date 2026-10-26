/**
 * Turn a folder or a zip into one skill: find its root, keep the text files, explain every
 * file it leaves out, and check the result against Fleet's limits. Runs in the browser; the
 * route handler re-checks the final file map with `bundleProblem`.
 *
 * Limits count only what is KEPT. Skipped files (binary, junk, outside the skill) never go
 * to Fleet, so a skill with a few MB of images still uploads and Review lists the images.
 */
import { readFrontMatter, setFrontMatter, type FrontMatterChange } from "./frontmatter"
import {
  bundleProblem,
  isBinaryName,
  isJunk,
  isSkillName,
  MAX_DESCRIPTION,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  pathProblem,
  SKILL_MD,
  slugify,
  utf8Bytes,
} from "./rules"

/** One file offered by a folder or a zip. `read` may throw `SkipFile` to skip just this file. */
export type Source = { path: string; size: number; symlink?: boolean; read: () => Promise<Uint8Array> }
export class SkipFile extends Error {}
/** Stops the whole upload (for example, a zip that unpacks to too much). */
export class Refused extends Error {}

export type Skipped = { path: string; reason: string }
export type SecretHit = { path: string; line: number; kind: string }

export type Bundle = {
  files: Record<string, string>
  skipped: Skipped[]
  bytes: number
  /** Suggested name: the front-matter name if valid, else slugified, else the folder or zip name. */
  name: string
  description: string
  secrets: SecretHit[]
}

/**
 * The skill root is the folder of the SHALLOWEST SKILL.md. A deeper SKILL.md is just a file
 * of the same skill (Fleet only loads `skills/<handle>/SKILL.md`). Two at the same shallowest
 * depth means several skills, which is refused.
 */
export function findRoot(paths: string[]): string {
  const marks = paths.filter((p) => p === SKILL_MD || p.endsWith(`/${SKILL_MD}`))
  if (!marks.length) throw new Refused("No SKILL.md found. A skill needs a SKILL.md file describing it.")
  const depth = (p: string) => p.split("/").length
  const min = Math.min(...marks.map(depth))
  const top = marks.filter((p) => depth(p) === min)
  if (top.length > 1) throw new Refused(`This holds ${top.length} skills (${top.map((p) => p.split("/").slice(-2, -1)[0] || "top level").join(", ")}). Upload one at a time.`)
  return top[0].slice(0, -SKILL_MD.length)
}

const decoder = () => new TextDecoder("utf-8", { fatal: true })

export async function collect(sources: Source[], fallbackName: string): Promise<Bundle> {
  const skipped: Skipped[] = []
  const seen = new Set<string>()
  const list: Source[] = []
  for (const s of sources) {
    const path = s.path.normalize("NFC")
    // Two names that differ only in Unicode form would collide once Fleet normalizes them.
    if (seen.has(path)) skipped.push({ path, reason: "duplicate name" })
    else {
      seen.add(path)
      list.push({ ...s, path })
    }
  }

  const root = findRoot(list.filter((s) => !isJunk(s.path)).map((s) => s.path))
  const files: Record<string, string> = {}
  let bytes = 0
  for (const s of list) {
    if (isJunk(s.path)) {
      skipped.push({ path: s.path, reason: "system file" })
      continue
    }
    if (!s.path.startsWith(root)) {
      skipped.push({ path: s.path, reason: "outside the skill folder" })
      continue
    }
    const rel = s.path.slice(root.length)
    const skip = (reason: string) => skipped.push({ path: rel, reason })
    const bad = pathProblem(rel)
    if (s.symlink) skip("symbolic link")
    else if (bad) skip(bad)
    else if (s.size > MAX_FILE_BYTES) skip("larger than 1 MB")
    else if (isBinaryName(rel)) skip("binary file (LangSmith stores text only)")
    else {
      let text: string
      try {
        text = decoder().decode(await s.read())
      } catch (err) {
        if (err instanceof Refused) throw err
        skip(err instanceof SkipFile ? err.message : "binary or not UTF-8 text")
        continue
      }
      files[rel] = text
      bytes += utf8Bytes(text)
      // Stop reading as soon as the kept text is over the limit: the answer cannot change.
      if (bytes > MAX_TOTAL_BYTES) throw new Refused("This skill has more than 4 MB of text; the limit is 4 MB.")
    }
  }

  const kept = Object.keys(files).length
  if (kept > MAX_FILES) throw new Refused(`This skill has ${kept} files; the limit is ${MAX_FILES}.`)
  if (files[SKILL_MD] === undefined) throw new Refused("SKILL.md could not be read as text.")

  const fm = readFrontMatter(files[SKILL_MD])
  const folder = root.split("/").filter(Boolean).pop() ?? fallbackName
  const name = fm.name && isSkillName(fm.name) ? fm.name : slugify(fm.name ?? "") || slugify(folder) || slugify(fallbackName)
  return { files, skipped, bytes, name, description: (fm.description ?? "").slice(0, MAX_DESCRIPTION), secrets: findSecrets(files) }
}

/** The files to send, with SKILL.md's front matter set to the chosen name and description. */
export function finalize(files: Record<string, string>, name: string, description: string): { files: Record<string, string>; changes: FrontMatterChange[]; problem: string | null } {
  const problem = !isSkillName(name)
    ? "The name must be lowercase words joined by hyphens, such as sales-research (64 characters at most)."
    : !description.trim()
      ? "Add a description: the agent reads it to decide when to use this skill."
      : description.length > MAX_DESCRIPTION
        ? `The description is longer than ${MAX_DESCRIPTION} characters.`
        : null
  if (problem) return { files, changes: [], problem }
  const { text, changes } = setFrontMatter(files[SKILL_MD] ?? "", { name, description: description.trim() })
  const out = { ...files, [SKILL_MD]: text }
  return { files: out, changes, problem: bundleProblem(out) }
}

/** SKILL.md for the Write form. */
export function writtenSkill(name: string, description: string, instructions: string): Record<string, string> {
  return { [SKILL_MD]: `---\nname: ${name}\ndescription: ${JSON.stringify(description.trim())}\n---\n\n${instructions.trim()}\n` }
}

// ── secret check: a warning, never a block; reports where, never the value ─────
const SECRET_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/, "API key (sk-…)"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, "GitHub token"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/\blsv2_(?:pt|sk)_[A-Za-z0-9_]{20,}/, "LangSmith key"],
  // No leading \b: `crm_api_key` and `client_secret` must match too.
  [/(?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*["']?[A-Za-z0-9_\-/+=]{16,}/i, "credential"],
]

export function findSecrets(files: Record<string, string>): SecretHit[] {
  const hits: SecretHit[] = []
  for (const [path, text] of Object.entries(files)) {
    text.split("\n").forEach((line, i) => {
      for (const [re, kind] of SECRET_PATTERNS) {
        if (re.test(line)) {
          hits.push({ path, line: i + 1, kind })
          break
        }
      }
    })
  }
  return hits.slice(0, 20)
}

/** Sources from `<input type="file" webkitdirectory>`. The chosen folder's name is the fallback name. */
export function folderSources(list: FileList | File[]): { sources: Source[]; folder: string } {
  const files = Array.from(list)
  const folder = (files[0] as File & { webkitRelativePath?: string })?.webkitRelativePath?.split("/")[0] ?? "skill"
  return {
    folder,
    sources: files.map((f) => ({
      path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
      size: f.size,
      read: async () => new Uint8Array(await f.arrayBuffer()),
    })),
  }
}
