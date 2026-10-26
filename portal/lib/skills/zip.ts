/**
 * A small zip reader for skill uploads. Runs in the BROWSER only: the portal server never
 * opens an archive, it receives the resulting `{path: text}` map and validates that.
 *
 * Built on the platform's `DecompressionStream("deflate-raw")`, so there is no dependency.
 * Deliberately narrow: stored and deflated entries only; encrypted and ZIP64 archives are
 * refused (a skill never needs either).
 *
 * Zip-bomb guard: declared sizes are checked before inflating, every entry is cut off at
 * 1 MB or its declared size (whichever is smaller, since declared sizes can lie), and the
 * whole archive may inflate at most 16 MB, kept or not.
 */
import { Refused, SkipFile, type Source } from "./bundle"
import { MAX_FILE_BYTES } from "./rules"

export const MAX_ZIP_BYTES = 20_000_000
export const MAX_INFLATED_BYTES = 16_000_000

const SIG_EOCD = 0x06054b50
const SIG_ZIP64_LOCATOR = 0x07064b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50

type Entry = { name: string | null; method: number; flags: number; compSize: number; size: number; offset: number; symlink: boolean }

function findEocd(v: DataView): number {
  const stop = Math.max(0, v.byteLength - 22 - 0xffff)
  for (let i = v.byteLength - 22; i >= stop; i--) if (v.getUint32(i, true) === SIG_EOCD) return i
  throw new Refused("This file is not a zip archive.")
}

function centralDirectory(buf: ArrayBuffer): Entry[] {
  const v = new DataView(buf)
  const eocd = findEocd(v)
  if (eocd >= 20 && v.getUint32(eocd - 20, true) === SIG_ZIP64_LOCATOR) throw new Refused("ZIP64 archives are not supported. A skill is never that large.")
  const count = v.getUint16(eocd + 10, true)
  const cdOffset = v.getUint32(eocd + 16, true)
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Refused("ZIP64 archives are not supported. A skill is never that large.")

  const names = new TextDecoder("utf-8", { fatal: true })
  const out: Entry[] = []
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    if (p + 46 > v.byteLength || v.getUint32(p, true) !== SIG_CENTRAL) throw new Refused("This zip archive is damaged.")
    const madeBy = v.getUint16(p + 4, true)
    const flags = v.getUint16(p + 8, true)
    const method = v.getUint16(p + 10, true)
    const compSize = v.getUint32(p + 20, true)
    const size = v.getUint32(p + 24, true)
    const nameLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const commentLen = v.getUint16(p + 32, true)
    const external = v.getUint32(p + 38, true)
    const offset = v.getUint32(p + 42, true)
    if (flags & 1) throw new Refused("This zip is encrypted. Upload an unencrypted zip.")
    if (compSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw new Refused("ZIP64 archives are not supported. A skill is never that large.")
    let name: string | null
    try {
      // UTF-8 even without the UTF-8 flag (bit 11): macOS Archive Utility writes UTF-8 and never sets it.
      name = names.decode(new Uint8Array(buf, p + 46, nameLen))
    } catch {
      name = null
    }
    // Unix "made by" with S_IFLNK in the high half of the external attributes.
    const symlink = madeBy >> 8 === 3 && ((external >>> 16) & 0o170000) === 0o120000
    out.push({ name, method, flags, compSize, size, offset, symlink })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

async function inflate(data: Uint8Array, limit: number, budget: { left: number }): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader()
  const chunks: Uint8Array[] = []
  let n = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      n += value.length
      budget.left -= value.length
      if (budget.left < 0) throw new Refused("This zip unpacks to more than 16 MB. Upload just the skill folder.")
      if (n > limit) throw new SkipFile("unpacks larger than its declared size or 1 MB")
      chunks.push(value)
    }
  } catch (err) {
    await reader.cancel().catch(() => {})
    if (err instanceof Refused || err instanceof SkipFile) throw err
    throw new SkipFile("damaged entry")
  }
  const out = new Uint8Array(n)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/** Read a zip into bundle sources. Entries are only inflated when `collect` decides to keep them. */
export async function zipSources(file: Blob): Promise<{ sources: Source[]; unreadable: string[] }> {
  if (file.size > MAX_ZIP_BYTES) throw new Refused("This zip is larger than 20 MB. Upload just the skill folder.")
  const buf = await file.arrayBuffer()
  const v = new DataView(buf)
  const budget = { left: MAX_INFLATED_BYTES }
  const sources: Source[] = []
  const unreadable: string[] = []
  for (const e of centralDirectory(buf)) {
    if (e.name === null) {
      unreadable.push("(a file whose name is not UTF-8)")
      continue
    }
    if (e.name.endsWith("/")) continue
    sources.push({
      path: e.name,
      size: e.size,
      symlink: e.symlink,
      read: async () => {
        if (e.method !== 0 && e.method !== 8) throw new SkipFile(`compression method ${e.method} is not supported`)
        if (e.offset + 30 > v.byteLength || v.getUint32(e.offset, true) !== SIG_LOCAL) throw new SkipFile("damaged entry")
        // The local header has its own name and extra lengths; the data starts after them.
        const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true)
        if (start + e.compSize > v.byteLength) throw new SkipFile("damaged entry")
        const data = new Uint8Array(buf, start, e.compSize)
        const limit = Math.min(MAX_FILE_BYTES, e.size)
        if (e.method === 0) {
          if (e.compSize > limit) throw new SkipFile("larger than 1 MB")
          budget.left -= e.compSize
          if (budget.left < 0) throw new Refused("This zip unpacks to more than 16 MB. Upload just the skill folder.")
          return data
        }
        return inflate(data, limit, budget)
      },
    })
  }
  return { sources, unreadable }
}
