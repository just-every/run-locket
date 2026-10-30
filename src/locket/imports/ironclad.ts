import { decodeBase64 } from '../artifacts'
import { date, fail, json, money, object, sha256, text } from '../model'
import { parseCsv } from './csv'
import type { SourceFile } from './docusign'
import { IMPORT_LIMIT, unzip } from './zip'
import { xlsxRows } from './xlsx'

export const IRONCLAD = 'ironclad-records'
export const IRONCLAD_MAPPING = 'ironclad-records/1'
export const agreementTypes = ['customer', 'supplier', 'nda', 'amendment', 'order_form', 'other'] as const
export const propertyTargets = ['title', 'counterparty', 'effective_date', 'end_date', 'renewal_type', 'renewal_term_months', 'renewals_allowed', 'notice_days', 'governing_law', 'payment_terms', 'value'] as const
export interface IroncladRecord {
  id: string; workflowId: string; name: string; type: string; status: string
  properties: Record<string, unknown>; attachments: string[]
  parentId: string; relation: string
}
export interface IroncladInput {
  label: string; manifest: SourceFile; files: SourceFile[]; originals: SourceFile[]; records: IroncladRecord[]
}
export interface IroncladMapping { types: Record<string, string>; properties: Record<string, string> }
const string = (v: unknown) => v === undefined || v === null ? '' : typeof v === 'object' ? json(v) : String(v)
const scalar = (v: unknown): unknown => v && typeof v === 'object' && 'value' in v ? (v as any).value : v
const named = (v: unknown) => v && typeof v === 'object' ? string((v as any).name ?? (v as any).id) : string(v)
const identity = (v: unknown) => v && typeof v === 'object' ? string((v as any).id) : string(v)
const split = (v: unknown) => Array.isArray(v) ? v.map(string) : string(v).split(/[;\n]/).map(s => s.trim()).filter(Boolean)
const structural = ['record id', 'record name', 'record type', 'workflow id', 'status', 'attachments', 'parent record id', 'relation', 'parent id', 'attachment filenames', 'stage', 'stage index', 'ironclad id', 'record type id', 'related record ids', 'workflow link', 'repository link']

export function normalizeRecords(raw: unknown): IroncladRecord[] {
  const input = Array.isArray(raw) ? raw : (raw as any)?.list ?? (raw as any)?.records
  if (!Array.isArray(input) || input.length > 250) fail('IRONCLAD_RECORDS', 'Supply at most 250 records per reviewed batch.')
  const records = input.map((value, i) => {
    const r = object(value, `record ${i + 1}`), columns = Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), v])), csv = 'record id' in columns
    const properties = csv ? Object.fromEntries(Object.entries(r).filter(([k]) => !structural.includes(k.toLowerCase()))) : object(r.properties ?? {}, 'properties')
    const parents = (r.parentRecords ?? (r.links as any)?.parents ?? []) as any[]
    if (!Array.isArray(parents) || parents.length > 1) fail('IRONCLAD_FAMILY', 'Resolve records with multiple parents before import.')
    const attachments = r.attachments ?? []
    const row: IroncladRecord = {
      id: string(csv ? columns['record id'] : r.id), workflowId: string(csv ? columns['workflow id'] : r.workflowId),
      name: string(csv ? columns['record name'] : r.name), type: named(csv ? columns['record type'] : r.recordType ?? r.type),
      status: string(csv ? columns.status ?? columns.stage : r.status), properties: Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, scalar(v)])),
      attachments: csv ? split(columns.attachments ?? columns['attachment filenames']) : Array.isArray(attachments) ? attachments.map(a => typeof a === 'string' ? a : string(a.path ?? a.filename ?? a.name)) : Object.values(attachments as object).map((a: any) => string(a.path ?? a.filename ?? a.name)),
      parentId: string(csv ? columns['parent record id'] ?? columns['parent id'] : r.parentId ?? identity(parents[0])),
      relation: string(csv ? columns.relation : r.relation ?? parents[0]?.relation),
    }
    if (!row.id || row.id.length > 200 || !row.type || row.type.length > 200 || row.id.includes('/')) fail('IRONCLAD_RECORDS', `Record ${i + 1} needs a plain ID and record type.`)
    return row
  })
  if (new Set(records.map(r => r.id)).size !== records.length) fail('IRONCLAD_RECORDS', 'Record IDs must be distinct in a batch.')
  // Some Records API exports express the same graph from the parent's child links.
  for (const [i, value] of input.entries()) {
    const children = value.childRecords ?? value.childIds ?? value.links?.children ?? []
    if (!Array.isArray(children)) fail('IRONCLAD_FAMILY', 'Child record links must be a list.')
    for (const child of children) {
      const linked = records.find(r => r.id === identity(child))
      if (!linked) continue // An out-of-selection link is retained in the original metadata.
      if (linked.parentId && linked.parentId !== records[i].id) fail('IRONCLAD_FAMILY', 'The source gives a child two different parents.')
      linked.parentId = records[i].id
      if (!linked.relation && child && typeof child === 'object') linked.relation = string(child.relation)
    }
  }
  return records
}

async function source(path: string, bytes: Uint8Array): Promise<SourceFile> { return { path, bytes, sha256: await sha256(bytes) } }
export async function readIroncladInput(p: Record<string, unknown>): Promise<IroncladInput> {
  const originals: SourceFile[] = [], files: SourceFile[] = []
  let manifest: SourceFile | undefined, raw: unknown = [], nestedRecords: IroncladRecord[] | undefined
  if (p.manifest) {
    const m = object(p.manifest, 'manifest')
    manifest = await source(text(m, 'filename', 200), decodeBase64(text(m, 'base64', 12_000_000)))
    originals.push(manifest)
    if (/\.jsonl?$/i.test(manifest.path)) {
      try {
        const decoded = new TextDecoder().decode(manifest.bytes)
        raw = /\.jsonl$/i.test(manifest.path) ? decoded.split(/\r?\n/).filter(s=>s.trim()).map(s=>JSON.parse(s)) : JSON.parse(decoded)
      } catch { fail('IRONCLAD_RECORDS', 'The metadata JSON is not readable.') }
    } else if (/\.xlsx$/i.test(manifest.path)) raw = await xlsxRows(manifest.bytes)
    else if (/\.csv$/i.test(manifest.path)) raw = parseCsv(new TextDecoder().decode(manifest.bytes)).rows
    else fail('IRONCLAD_RECORDS', 'Choose metadata in CSV, JSON or XLSX format.')
  }
  if (p.archive) {
    const a = object(p.archive, 'archive'), archive = await source(text(a, 'filename', 200), decodeBase64(text(a, 'base64', 12_000_000)))
    originals.push(archive)
    for (const [path, bytes] of await unzip(archive.bytes)) {
      if (!manifest && /(?:^|\/)records\.(json|csv|xlsx)$/i.test(path)) {
        const nested = await readIroncladInput({ label: p.label, manifest: { filename: path.split('/').pop(), base64: btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')) } })
        manifest = nested.manifest; nestedRecords = nested.records; originals.push(manifest)
      } else files.push(await source(path, bytes))
    }
  }
  if (p.files !== undefined) {
    if (!Array.isArray(p.files) || p.files.length > 400) fail('IRONCLAD_RECORDS', 'Supply at most 400 files per batch.')
    for (const value of p.files) {
      const f = object(value), path = text(f, 'path', 400)
      if (path.startsWith('/') || /[\\\u0000-\u001f]/.test(path) || path.split('/').some(s => !s || s === '.' || s === '..')) fail('IMPORT_PATH', 'Use plain relative file paths.')
      const file = await source(path, decodeBase64(text(f, 'base64', 12_000_000))); files.push(file); originals.push(file)
    }
  }
  if (new Set(files.map(f => f.path)).size !== files.length) fail('IMPORT_PATH', 'File paths must be distinct.')
  const custody=new Map([...originals,...files].map(f=>[f.path+'#'+f.sha256,f]))
  if ([...custody.values()].reduce((n, f) => n + f.bytes.length, 0) > IMPORT_LIMIT) fail('IMPORT_SIZE', 'Split this move-in into batches of at most 6 MB including expanded files.', 413)
  // Attachments alone still produce an honest orphan report; no record identity is invented.
  manifest ??= await source('records.json', new TextEncoder().encode('[]'))
  const records = nestedRecords ?? normalizeRecords(raw)
  return { label: text(p, 'label', 200), manifest, files, originals, records }
}

const defaults: Record<string, string> = {
  'governing law':'governing_law','payment terms':'payment_terms',
  'effective date': 'effective_date', 'renewals allowed': 'renewals_allowed', 'renewal term': 'renewal_term_months',
  'agreement date': 'effective_date', agreementDate: 'effective_date', 'expiration date': 'end_date', expirationDate: 'end_date',
  'auto-renewal type': 'renewal_type', autoRenewalType: 'renewal_type', 'renewal term length': 'renewal_term_months', renewalTermLength: 'renewal_term_months',
  'number of renewals': 'renewals_allowed', numberOfRenewals: 'renewals_allowed', 'notice days': 'notice_days', noticeDays: 'notice_days',
  counterparty: 'counterparty', 'contract value': 'value', contractValue: 'value', title: 'title',
}
export function mappingCatalogue(input: IroncladInput, supplied?: unknown) {
  const types = [...new Set(input.records.map(r => r.type))].sort(), properties = [...new Set(input.records.flatMap(r => Object.keys(r.properties)))].sort()
  const raw = supplied === undefined ? { types: {}, properties: {} } : object(supplied, 'mapping')
  const typeMap = object(raw.types ?? {}), propertyMap = object(raw.properties ?? {})
  const mapping: IroncladMapping = {
    types: Object.fromEntries(types.map(t => [t, string(typeMap[t]) || (/amend/i.test(t) ? 'amendment' : /order/i.test(t) ? 'order_form' : /nda/i.test(t) ? 'nda' : 'other')])),
    properties: Object.fromEntries(properties.map(k => [k, string(propertyMap[k]) || defaults[k] || defaults[k.toLowerCase()] || 'unmapped'])),
  }
  for (const t of Object.values(mapping.types)) if (!agreementTypes.includes(t as any)) fail('IRONCLAD_MAPPING', 'Choose a Locket agreement type for each source type.')
  for (const target of Object.values(mapping.properties)) if (!['unmapped', 'skip', ...propertyTargets].includes(target) && !target.startsWith('custom:')) fail('IRONCLAD_MAPPING', 'Choose a Locket field, a custom field or skip.')
  const chosen = Object.values(mapping.properties).filter(t => !['unmapped', 'skip'].includes(t))
  if (new Set(chosen).size !== chosen.length) fail('IRONCLAD_MAPPING', 'Map each destination field only once.')
  return { mapping, types, properties, unmapped: properties.filter(k => mapping.properties[k] === 'unmapped') }
}

export function mappedValue(key: string, raw: unknown): string {
  const value = string(raw).trim()
  if (['effective_date', 'end_date'].includes(key)) return date({ value }, 'value')
  if (key === 'renewal_type') {
    const normalized = value.toLowerCase().replace(/[ -]/g, '_')
    const type = ({ fixed_term: 'fixed', auto_renews: 'auto_renew', automatically_renews: 'auto_renew', automatic: 'auto_renew', none: 'fixed' } as Record<string, string>)[normalized] ?? normalized
    if (!['fixed', 'auto_renew', 'evergreen', 'optional'].includes(type)) fail('IRONCLAD_VALUE', `Unrecognized renewal type: ${value}. Edit the mapping or correct the export.`)
    return type
  }
  if (['renewal_term_months', 'renewals_allowed', 'notice_days'].includes(key)) {
    if (key === 'renewals_allowed' && (!value || value.toLowerCase() === 'unlimited')) return ''
    if (!/^\d+$/.test(value) || Number(value) > (key === 'renewal_term_months' ? 120 : key === 'notice_days' ? 730 : 100000) || (key === 'renewal_term_months' && !Number(value))) fail('IRONCLAD_VALUE', `Map ${key} to a whole number in its supported range.`)
  }
  if (key === 'value' && money({value},'value')===null) fail('IRONCLAD_VALUE','Supply the contract value in USD.')
  return value
}
