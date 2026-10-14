// Exact-byte custody for uploaded, generated and imported files. Bytes are
// stored once, in order, and never rewritten; the SHA-256 identifies them.
import { fail, json, object, sha256, sql, type Sql } from './model'

export const MAX_FILE_BYTES = 5 * 1024 * 1024
const CHUNK = 512 * 1024

export const PDF = 'application/pdf'
export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export interface FileInput {
  filename: string
  mediaType: string
  bytes: Uint8Array
}

export function decodeBase64(value: string): Uint8Array {
  let binary: string
  try {
    binary = atob(value)
  } catch {
    fail('INVALID', 'File content must be base64.')
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
export function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Validates a `{filename, mediaType, base64}` payload field. */
export function fileInput(value: unknown, name = 'file'): FileInput {
  const p = object(value, name)
  const filename = typeof p.filename === 'string' ? p.filename.trim() : ''
  if (!filename || filename.length > 255 || /[\\/\u0000-\u001f]/.test(filename)) fail('INVALID', `${name}.filename must be a plain file name.`)
  if (typeof p.base64 !== 'string' || !p.base64) fail('INVALID', `${name}.base64 is required.`)
  const bytes = decodeBase64(p.base64)
  if (!bytes.length) fail('INVALID', `${name} is empty.`)
  if (bytes.length > MAX_FILE_BYTES) fail('FILE_SIZE', `${name} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB. Split schedules into separate files.`, 413)
  const mediaType = typeof p.mediaType === 'string' && p.mediaType ? p.mediaType : sniff(filename, bytes)
  return { filename, mediaType, bytes }
}

function sniff(filename: string, bytes: Uint8Array): string {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return PDF
  if (/\.docx$/i.test(filename) && bytes[0] === 0x50 && bytes[1] === 0x4b) return DOCX
  return 'application/octet-stream'
}
export const isPdf = (f: { bytes: Uint8Array }) => f.bytes[0] === 0x25 && f.bytes[1] === 0x50 && f.bytes[2] === 0x44 && f.bytes[3] === 0x46
export const isDocx = (f: { filename: string; bytes: Uint8Array }) => /\.docx$/i.test(f.filename) && f.bytes[0] === 0x50 && f.bytes[1] === 0x4b

export interface StoredArtifact {
  id: string
  sha256: string
  size: number
  writes: Sql[]
}
export interface ArtifactMeta {
  agreementId: string | null
  versionId?: string | null
  role: string
  sourceSystem?: string | null
  sourceId?: string | null
  provenance: Record<string, unknown>
  imported?: boolean
  actorId: string
  at: number
}
export async function storeArtifact(file: FileInput, meta: ArtifactMeta, id = crypto.randomUUID()): Promise<StoredArtifact> {
  const digest = await sha256(file.bytes)
  const writes: Sql[] = [
    sql(
      'INSERT INTO lk_artifacts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id,
      meta.agreementId,
      meta.versionId ?? null,
      meta.role,
      file.filename,
      file.mediaType,
      file.bytes.length,
      digest,
      meta.sourceSystem ?? null,
      meta.sourceId ?? null,
      json(meta.provenance),
      meta.imported ? 1 : 0,
      meta.actorId,
      meta.at,
    ),
  ]
  for (let i = 0, n = 0; i < file.bytes.length; i += CHUNK, n++) writes.push(sql('INSERT INTO lk_artifact_chunks VALUES(?,?,?)', id, n, file.bytes.slice(i, i + CHUNK)))
  return { id, sha256: digest, size: file.bytes.length, writes }
}

export async function readArtifactBytes(db: D1Database, id: string): Promise<Uint8Array> {
  const rows = await db.prepare('SELECT bytes FROM lk_artifact_chunks WHERE artifact_id=? ORDER BY ordinal').bind(id).all<{ bytes: ArrayBuffer | number[] }>()
  const parts = rows.results.map(r => new Uint8Array(r.bytes as ArrayBuffer))
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}
