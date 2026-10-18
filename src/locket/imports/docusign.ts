// DocuSign archive move-in kit: an envelope report CSV plus the completed
// envelopes' signed PDFs and Certificates of Completion, laid out one folder per
// envelope ID. See IMPORT.md for the documented shape and its limits.
// Imported evidence stays labelled imported; Locket never creates a certificate.
import { decodeBase64, isPdf, PDF } from '../artifacts'
import { fail, list, object, oneOf, sha256, text } from '../model'
import { parseCsv } from './csv'

export const KIT = 'docusign-archive'
export const MAPPING_VERSION = 'docusign-archive/1'

const aliases: Record<string, string[]> = {
  envelopeId: ['envelope id', 'envelopeid', 'envelope_id'],
  subject: ['subject', 'envelope subject', 'email subject'],
  status: ['status', 'envelope status'],
  completed: ['completed on', 'completed', 'completed date', 'completed time', 'envelope completed'],
  recipients: ['recipient name', 'recipients', 'recipient(s)', 'signers', 'recipient'],
  recipientEmails: ['recipient email', 'recipient emails'],
  sender: ['sender email', 'sender', 'from'],
  counterparty: ['counterparty'],
  type: ['agreement type'],
  endDate: ['end date', 'expiry date', 'expiration date'],
  noticeDays: ['notice days', 'notice period days'],
}
const required = ['envelopeId', 'subject', 'status', 'completed']

export interface SourceFile {
  path: string
  bytes: Uint8Array
  sha256: string
}
export interface PreviewRow {
  row: number
  envelopeId: string
  subject: string
  status: string
  completedOn: string | null
  recipients: { name: string; email: string }[]
  counterparty: string
  counterpartyInferred: boolean
  type: string
  endDate: string | null
  noticeDays: number | null
  document: { path: string; sha256: string; size: number } | null
  schedules: { path: string; sha256: string; size: number }[]
  certificate: { path: string; sha256: string; size: number } | null
  outcome: 'import' | 'skip' | 'duplicate' | 'missing'
  notes: string[]
}

function parseDate(value: string, format: 'iso' | 'dmy' | 'mdy'): string | null {
  const v = value.trim()
  if (!v) return null
  let y: number, m: number, d: number
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else {
    const parts = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (!parts || format === 'iso') return null
    ;[d, m] = format === 'dmy' ? [Number(parts[1]), Number(parts[2])] : [Number(parts[2]), Number(parts[1])]
    y = Number(parts[3])
  }
  const out = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  // A date read in the wrong order (a 14th month) is no date, not a failed request.
  const at = Date.parse(out + 'T00:00:00Z')
  return !Number.isNaN(at) && new Date(at).toISOString().slice(0, 10) === out ? out : null
}

function recipients(value: string) {
  return value
    .split(/[;\n]/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(entry => {
      const m = entry.match(/^(.*?)\s*<([^>]+)>$/)
      return m ? { name: m[1].trim() || m[2], email: m[2].trim().toLowerCase() } : { name: entry, email: entry.includes('@') ? entry.toLowerCase() : '' }
    })
}

export interface KitInput {
  label: string
  dateFormat: 'iso' | 'dmy' | 'mdy'
  manifest: { filename: string; bytes: Uint8Array; sha256: string }
  files: SourceFile[]
}
export async function readKitInput(p: Record<string, unknown>): Promise<KitInput> {
  const manifest = object(p.manifest, 'manifest')
  const manifestBytes = decodeBase64(text(manifest, 'base64', 20_000_000))
  const files: SourceFile[] = []
  let total = manifestBytes.length
  for (const [i, value] of list(p, 'files', 400).entries()) {
    const f = object(value, `files[${i}]`)
    const path = text(f, 'path', 400).replace(/\\/g, '/').replace(/^\/+/, '')
    if (path.split('/').some(seg => seg === '..' || seg === '')) fail('INVALID', `${path} is not a plain relative path.`)
    const bytes = decodeBase64(text(f, 'base64', 20_000_000))
    total += bytes.length
    if (files.some(x => x.path === path)) fail('INVALID', `${path} appears twice.`)
    files.push({ path, bytes, sha256: await sha256(bytes) })
  }
  if (total > 6 * 1024 * 1024) fail('IMPORT_SIZE', 'One move-in batch carries at most 6 MB of files. Split the archive into several batches by date range.', 413)
  return { label: text(p, 'label', 200), dateFormat: oneOf(p, 'dateFormat', ['iso', 'dmy', 'mdy'] as const), manifest: { filename: text(manifest, 'filename', 200), bytes: manifestBytes, sha256: await sha256(manifestBytes) }, files }
}

/** Dry run: what each manifest row would become, with every gap stated. */
export async function preview(db: D1Database, input: KitInput) {
  const { header, rows } = parseCsv(new TextDecoder('utf-8', { fatal: false }).decode(input.manifest.bytes))
  const column: Record<string, string | undefined> = {}
  for (const [key, names] of Object.entries(aliases)) column[key] = header.find(h => names.includes(h.toLowerCase()))
  const absent = required.filter(k => !column[k])
  if (absent.length) fail('MANIFEST_COLUMNS', `The envelope report is missing columns: ${absent.map(k => aliases[k][0]).join(', ')}.`, 400, { header })
  const get = (r: Record<string, string>, key: string) => (column[key] ? r[column[key]!] ?? '' : '')
  const used = new Set<string>(), seen = new Set<string>()
  const out: PreviewRow[] = []
  for (const [i, r] of rows.entries()) {
    const envelopeId = get(r, 'envelopeId')
    const notes: string[] = []
    // Names and emails may arrive in one "Name <email>" column or as matching lists.
    const emails = get(r, 'recipientEmails').split(/[;\n]/).map(x => x.trim().toLowerCase()).filter(Boolean)
    const people = recipients(get(r, 'recipients')).map((p, n) => (p.email || !emails[n] ? p : { ...p, email: emails[n] }))
    const senderDomain = get(r, 'sender').split('@')[1]?.toLowerCase()
    let counterparty = get(r, 'counterparty'), inferred = false
    if (!counterparty) {
      const other = people.find(p => p.email && p.email.split('@')[1] !== senderDomain)
      counterparty = other ? other.email.split('@')[1] : 'Unknown counterparty'
      inferred = true
      notes.push(`Counterparty inferred as ${counterparty}; rename it after import.`)
    }
    const typeValue = get(r, 'type').toLowerCase().replace(/\s+/g, '_')
    const type = ['customer', 'supplier', 'nda', 'amendment', 'order_form', 'other'].includes(typeValue) ? typeValue : 'other'
    const folder = input.files.filter(f => f.path.split('/')[0] === envelopeId && f.path.toLowerCase().endsWith('.pdf'))
    const certificates = folder.filter(f => /summary|certificate/i.test(f.path.split('/').pop()!))
    const documents = folder.filter(f => !certificates.includes(f))
    for (const f of folder) if (!isPdf(f)) notes.push(`${f.path} is not a PDF; it is not imported.`)
    const pdfDocs = documents.filter(f => isPdf(f)), pdfCerts = certificates.filter(f => isPdf(f))
    const endDate = parseDate(get(r, 'endDate'), input.dateFormat)
    const notice = get(r, 'noticeDays')
    const noticeDays = /^\d{1,3}$/.test(notice) ? Number(notice) : null
    if (get(r, 'endDate') && !endDate) notes.push(`End date "${get(r, 'endDate')}" is not a ${input.dateFormat.toUpperCase()} date; not proposed.`)
    const row: PreviewRow = {
      row: i + 2,
      envelopeId,
      subject: get(r, 'subject'),
      status: get(r, 'status'),
      completedOn: parseDate(get(r, 'completed'), input.dateFormat),
      recipients: people,
      counterparty,
      counterpartyInferred: inferred,
      type,
      endDate,
      noticeDays,
      document: pdfDocs[0] ? { path: pdfDocs[0].path, sha256: pdfDocs[0].sha256, size: pdfDocs[0].bytes.length } : null,
      schedules: pdfDocs.slice(1).map(f => ({ path: f.path, sha256: f.sha256, size: f.bytes.length })),
      certificate: pdfCerts[0] ? { path: pdfCerts[0].path, sha256: pdfCerts[0].sha256, size: pdfCerts[0].bytes.length } : null,
      outcome: 'import',
      notes,
    }
    folder.forEach(f => used.add(f.path))
    if (!envelopeId) { row.outcome = 'missing'; notes.push('The row has no envelope ID.') }
    else if (seen.has(envelopeId)) { row.outcome = 'duplicate'; notes.push('The same envelope appears earlier in this manifest.') }
    else if (row.status.toLowerCase() !== 'completed') { row.outcome = 'skip'; notes.push(`Only completed envelopes are imported; this one is ${row.status || 'without a status'}.`) }
    else if (!row.document) { row.outcome = 'missing'; notes.push('No signed PDF was supplied in this envelope’s folder.') }
    else if (!row.completedOn) { row.outcome = 'missing'; notes.push(`Completed date "${get(r, 'completed')}" is not a ${input.dateFormat.toUpperCase()} date.`) }
    else {
      const held = await db.prepare("SELECT 1 AS x FROM lk_executions WHERE provider='docusign' AND envelope_id=? UNION SELECT 1 FROM lk_artifacts WHERE sha256=? AND role IN ('original','signed')").bind(envelopeId, row.document.sha256).first()
      if (held) { row.outcome = 'duplicate'; notes.push('This envelope or its signed file is already held in Locket.') }
    }
    if (row.outcome === 'import' && !row.certificate) notes.push(pdfDocs.length === 1 ? 'No separate Certificate of Completion. A combined PDF holds it only when the DocuSign account attaches certificates; the execution is flagged for review.' : 'No Certificate of Completion was supplied; the execution is flagged for review.')
    seen.add(envelopeId)
    out.push(row)
  }
  const orphans = input.files.filter(f => !used.has(f.path)).map(f => f.path)
  const counts = {
    rows: out.length,
    import: out.filter(r => r.outcome === 'import').length,
    skip: out.filter(r => r.outcome === 'skip').length,
    duplicate: out.filter(r => r.outcome === 'duplicate').length,
    missing: out.filter(r => r.outcome === 'missing').length,
    withoutCertificate: out.filter(r => r.outcome === 'import' && !r.certificate).length,
    orphanFiles: orphans.length,
    bytes: input.files.reduce((n, f) => n + f.bytes.length, 0),
  }
  return { rows: out, orphans, counts, manifest: { filename: input.manifest.filename, sha256: input.manifest.sha256, columns: header } }
}
export { PDF }
