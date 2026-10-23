// Reads the paragraph text of a DOCX (word/document.xml) for comparison and
// review. The original DOCX bytes are always kept; this is a text rendition only.
import { fail } from './model'
import { MAX_WORD_PART_BYTES } from './word-template-document'

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

/** Inflates a part, stopping as soon as it expands past the size its package declares. */
async function inflateRaw(data: Uint8Array, declared: number): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.length
    if (size > declared) {
      await reader.cancel()
      fail('DOCX', 'The DOCX main document expands beyond its declared size.')
    }
    chunks.push(chunk.value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

async function zipEntry(zip: Uint8Array, wanted: string): Promise<Uint8Array | null> {
  let end = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (u32(zip, i) === 0x06054b50) { end = i; break }
  if (end < 0) fail('DOCX', 'The DOCX file is not a readable ZIP package.')
  const count = u16(zip, end + 10)
  let offset = u32(zip, end + 16)
  const decoder = new TextDecoder()
  for (let n = 0; n < count; n++) {
    if (u32(zip, offset) !== 0x02014b50) fail('DOCX', 'The DOCX central directory is damaged.')
    const method = u16(zip, offset + 10), compressed = u32(zip, offset + 20), declared = u32(zip, offset + 24)
    const nameLength = u16(zip, offset + 28), extraLength = u16(zip, offset + 30), commentLength = u16(zip, offset + 32)
    const local = u32(zip, offset + 42)
    const name = decoder.decode(zip.subarray(offset + 46, offset + 46 + nameLength))
    if (name === wanted) {
      if (declared > MAX_WORD_PART_BYTES) fail('DOCX', 'The DOCX main document is too large to read.')
      const start = local + 30 + u16(zip, local + 26) + u16(zip, local + 28)
      const data = zip.subarray(start, start + compressed)
      if (method === 0) return data
      if (method === 8) return inflateRaw(data, declared)
      fail('DOCX', 'The DOCX uses an unsupported compression method.')
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  return null
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unescape = (s: string) => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (_, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : entities[e.toLowerCase()]))

export async function docxText(bytes: Uint8Array): Promise<string> {
  const xml = await zipEntry(bytes, 'word/document.xml')
  if (!xml) fail('DOCX', 'The DOCX has no main document part.')
  const body = new TextDecoder().decode(xml)
  const paragraphs = body.split(/<\/w:p>/)
  const lines: string[] = []
  for (const p of paragraphs) {
    let line = ''
    for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)) line += m[1] !== undefined ? unescape(m[1]) : m[0] === '<w:tab/>' ? '\t' : '\n'
    if (/<w:p[\s>]/.test(p)) lines.push(line)
  }
  return lines.join('\n').trim()
}
