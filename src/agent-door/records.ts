import type { Bindings } from '../auth.server'
import { state } from '../locket/views'
import type { Actor } from '../locket/model'
import { ToolRefusal, type ClassAndFacts } from '../modules/agent-door/index.ts'
import { nativeCall } from './native'

export const recordKinds = {
  agreements: 'agreements', versions: 'versions', files: 'artifacts', counterparties: 'parties',
  templates: 'templates', playbooks: 'playbooks', findings: 'deviations', obligations: 'obligations',
  renewals: 'renewals', notices: 'notices', reports: 'reports',
} as const
export type RecordKind = keyof typeof recordKinds
export type NativeRecord = Record<string, unknown>

/** Use the exact native workspace visibility and field projection, then select a
 * single record. Never return opaque provider, queue or credential state. */
export async function records(env: Bindings, actor: Actor, kind: RecordKind): Promise<NativeRecord[]> {
  const workspace = await nativeCall(() => state(env, actor))
  const rows = workspace[recordKinds[kind]] as NativeRecord[]
  const fields: Record<RecordKind, string[]> = {
    agreements: ['id','reference','title','type','party_id','value_cents','currency','owner_id','requester_id','status','restricted','needed_by','start_date','timezone','parent_id','relation','current_version_id','entity_id','created_at','updated_at','version'],
    versions: ['id','agreement_id','number','kind','label','template_version_id','text','text_source','digest','created_by','created_at'],
    files: ['id','agreement_id','version_id','role','filename','media_type','size','sha256','source_system','source_id','imported','uploaded_by','uploaded_at'],
    counterparties: ['id','name','kind','entity_type','formation','registered_address','notice_address','notice_method','tax_id','tax_id_kind','email','version'],
    templates: ['id','name','type','entity_id','created_by','created_at'],
    playbooks: ['id','number','status','rules','created_by','created_at','activated_by','activated_at'],
    findings: ['id','agreement_id','version_id','clause_key','result','start','end','quote','explanation','proposed_wording','questions','created_by','created_at'],
    obligations: ['id','agreement_id','description','owner_id','due_date','recurrence','status','citation','created_by','created_at','version'],
    renewals: ['id','agreement_id','end_date','notice_days','deadline_at','status','decision','reason','decided_by','decided_at'],
    notices: ['id','agreement_id','renewal_id','recipient','body','status','prepared_by','prepared_at','approved_by','approved_at','sent_at','method'],
    reports: ['id','name','view_id','definition','group_by','created_by','created_at','version','schedule','stopped_at'],
  }
  return rows.map(row => Object.fromEntries(fields[kind].filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]])))
}
export async function record(env: Bindings, actor: Actor, kind: RecordKind, id: string) {
  const row = (await records(env, actor, kind)).find(row => row.id === id)
  if (!row) throw new ToolRefusal('resource_unavailable')
  return row
}

/** Classification reads the record's own fields, never a caller-provided risk. */
export function classification(value: unknown): ClassAndFacts[] {
  const sensitive = (v: unknown): boolean => {
    if (Array.isArray(v)) return v.some(sensitive)
    if (!v || typeof v !== 'object') return typeof v === 'string' && /\b\d{2}-\d{7}\b|\b\d{3}-\d{2}-\d{4}\b/.test(v)
    return Object.entries(v).some(([key, item]) => /^(tax_id|taxId|bank_account|ssn)$/.test(key) && Boolean(item) || sensitive(item))
  }
  return [{ class: 'standard', facts: { measure: 1 } }, ...(sensitive(value) ? [{ class: 'sensitive' as const, facts: { measure: 1, kind: 'tax_identifier' } }] : [])]
}
