/**
 * What a workspace skill may contain. Shared by the browser (to explain problems before
 * upload) and the route handler (which cannot trust the browser), so the two never disagree.
 *
 * Fleet's own limits: name `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` up to 64 chars, at most 500
 * entries, a 5 MiB body, text content only. The per-file and total limits mirror
 * LangSmith's own folder upload: 1 MB per file, 4 MB in total, 20 folder levels.
 */

export const SKILL_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
export const MAX_NAME = 64
export const MAX_FILES = 500
export const MAX_FILE_BYTES = 1_000_000
export const MAX_TOTAL_BYTES = 4_000_000
export const MAX_DEPTH = 20
export const MAX_DESCRIPTION = 1024
/** Fleet refuses a larger `POST /v1/fleet/skills` body with 413; keep headroom for the envelope. */
export const MAX_FLEET_BODY = 5 * 1024 * 1024 - 64 * 1024
export const SKILL_MD = "SKILL.md"

const encoder = new TextEncoder()
export const utf8Bytes = (s: string) => encoder.encode(s).length

export function isSkillName(s: string): boolean {
  return s.length <= MAX_NAME && SKILL_NAME.test(s)
}

/** Lowercase words joined by hyphens, as Fleet requires. "" if nothing usable is left. */
export function slugify(s: string): string {
  const out = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/, "")
    .slice(0, MAX_NAME)
    .replace(/-+$/, "")
  return out
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const BAD_CHARS = /[<>:"|?*\\]/
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/

/** Why Fleet would reject this relative path, or null if it is fine. */
export function pathProblem(path: string): string | null {
  if (!path) return "empty path"
  if (path.startsWith("/")) return "absolute path"
  if (path !== path.normalize("NFC")) return "name is not NFC-normalized"
  if (utf8Bytes(path) > 1024) return "path longer than 1024 bytes"
  if (CONTROL.test(path)) return "control character in name"
  if (BAD_CHARS.test(path)) return 'name contains one of < > : " | ? * \\'
  for (const seg of path.split("/")) {
    if (!seg) return "empty folder name"
    if (seg === "." || seg === "..") return "'.' or '..' in path"
    if (utf8Bytes(seg) > 255) return "a name longer than 255 bytes"
    if (RESERVED.test(seg)) return `reserved name "${seg}"`
  }
  if (path.split("/").length > MAX_DEPTH) return `deeper than ${MAX_DEPTH} folder levels`
  return null
}

/** OS and archive clutter that is never part of a skill. */
export function isJunk(path: string): boolean {
  const segs = path.split("/")
  const base = segs[segs.length - 1]
  return segs.includes("__MACOSX") || base === ".DS_Store" || base === "Thumbs.db" || base.startsWith("._")
}

/** Extensions skipped without reading: Fleet stores text only. Anything else is decided by decoding. */
const BINARY_EXT = new Set(
  "png jpg jpeg gif webp bmp ico tif tiff heic psd ai sketch fig pdf doc docx xls xlsx ppt pptx key numbers pages zip gz tgz bz2 xz 7z rar jar war tar woff woff2 ttf otf eot mp3 mp4 m4a mov avi wav ogg webm flac exe dll so dylib bin class o a pyc wasm sqlite db".split(" "),
)
export function isBinaryName(path: string): boolean {
  const dot = path.lastIndexOf(".")
  return dot > path.lastIndexOf("/") && BINARY_EXT.has(path.slice(dot + 1).toLowerCase())
}

/**
 * The whole-bundle check both sides run on the final `{path: text}` map. Returns the first
 * problem in plain words, or null.
 */
export function bundleProblem(files: Record<string, string>): string | null {
  const paths = Object.keys(files)
  if (!paths.includes(SKILL_MD)) return "SKILL.md must be at the top of the skill."
  if (paths.length > MAX_FILES) return `A skill can hold at most ${MAX_FILES} files (this one has ${paths.length}).`
  let total = 0
  for (const p of paths) {
    const why = pathProblem(p)
    if (why) return `${p}: ${why}.`
    const bytes = utf8Bytes(files[p])
    if (bytes > MAX_FILE_BYTES) return `${p} is larger than 1 MB.`
    total += bytes
  }
  if (total > MAX_TOTAL_BYTES) return `The skill is ${(total / 1e6).toFixed(1)} MB; the limit is 4 MB of text.`
  return null
}

/** The exact body sent to Fleet. Its size, not the raw text size, is what the 5 MiB limit counts. */
export function fleetSkillBody(name: string, files: Record<string, string>) {
  return { name, files: Object.fromEntries(Object.entries(files).map(([p, content]) => [p, { content }])) }
}
