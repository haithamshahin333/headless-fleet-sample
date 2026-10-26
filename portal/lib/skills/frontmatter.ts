/**
 * Just enough YAML front matter for SKILL.md: read `name` and `description`, and rewrite
 * those two keys without disturbing anything else. No YAML library — skills use a tiny
 * subset (plain, quoted, or `|` / `>` block scalars), and every rewrite is shown to the
 * user in Review before anything is sent.
 */

export type FrontMatter = { block: boolean; name?: string; description?: string }
export type FrontMatterChange = { field: "name" | "description" | "front matter"; before: string | null; after: string }

const BLOCK = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

type Entry = { key: string; start: number; end: number; value: string }

/** Top-level `key: value` entries, each with the line span it occupies (continuations included). */
function entries(lines: string[]): Entry[] {
  const out: Entry[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_][\w-]*):(.*)$/.exec(lines[i])
    if (!m) continue
    let end = i + 1
    while (end < lines.length && (/^\s+\S/.test(lines[end]) || lines[end].trim() === "")) end++
    // Trailing blank lines belong to nobody.
    while (end > i + 1 && lines[end - 1].trim() === "") end--
    out.push({ key: m[1], start: i, end, value: scalar(m[2].trim(), lines.slice(i + 1, end)) })
    i = end - 1
  }
  return out
}

function scalar(head: string, rest: string[]): string {
  const block = /^([|>])[+-]?\d*$/.exec(head)
  if (block) {
    const body = rest.map((l) => l.replace(/^\s+/, ""))
    return (block[1] === "|" ? body.join("\n") : body.filter(Boolean).join(" ")).trim()
  }
  if (head.startsWith('"')) {
    try {
      return JSON.parse([head, ...rest.map((l) => l.trim())].join(" "))
    } catch {
      return head.replace(/^"|"$/g, "")
    }
  }
  if (head.startsWith("'")) return [head, ...rest.map((l) => l.trim())].join(" ").replace(/^'|'$/g, "").replace(/''/g, "'")
  return [head, ...rest.map((l) => l.trim())].join(" ").trim()
}

export function readFrontMatter(md: string): FrontMatter {
  const m = BLOCK.exec(md)
  if (!m) return { block: false }
  const found = Object.fromEntries(entries(m[1].split(/\r?\n/)).map((e) => [e.key, e.value]))
  return { block: true, name: found.name || undefined, description: found.description || undefined }
}

/** A YAML double-quoted scalar; JSON string escaping is valid YAML. */
const quote = (s: string) => JSON.stringify(s)

/**
 * Set `name` and `description`, touching only what differs. Returns the new text and
 * the list of changes for Review (empty when the file already matches).
 */
export function setFrontMatter(md: string, want: { name: string; description: string }): { text: string; changes: FrontMatterChange[] } {
  const m = BLOCK.exec(md)
  if (!m) {
    const head = `---\nname: ${want.name}\ndescription: ${quote(want.description)}\n---\n\n`
    return { text: head + md.replace(/^﻿/, ""), changes: [{ field: "front matter", before: null, after: `name: ${want.name}, description added` }] }
  }
  const lines = m[1].split(/\r?\n/)
  const found = entries(lines)
  const changes: FrontMatterChange[] = []
  const set = (key: "name" | "description", line: string, before: string | undefined) => {
    const e = found.find((x) => x.key === key)
    changes.push({ field: key, before: before ?? null, after: key === "name" ? want.name : want.description })
    if (e) lines.splice(e.start, e.end - e.start, line)
    else lines.unshift(line)
    // Line numbers moved: re-read before the next edit.
    found.splice(0, found.length, ...entries(lines))
  }
  const cur = readFrontMatter(md)
  if (cur.description !== want.description) set("description", `description: ${quote(want.description)}`, cur.description)
  if (cur.name !== want.name) set("name", `name: ${want.name}`, cur.name)
  if (!changes.length) return { text: md, changes }
  // The block's body starts on the line after the opening `---` (BLOCK is anchored at 0).
  const start = m[0].indexOf("\n") + 1
  const eol = m[0].includes("\r\n") ? "\r\n" : "\n"
  return { text: md.slice(0, start) + lines.join(eol) + md.slice(start + m[1].length), changes: changes.reverse() }
}
