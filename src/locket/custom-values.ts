import { requireRole, visibleSql } from './access'
import type { Ctx, Handler } from './commands'
import { customFieldChecks, customFields, fieldApplies, fieldRequired, type CustomField } from './custom-fields'
import { date, fail, integer, json, money, object, parse, sql, text, type Role, type Sql } from './model'
import { agreementGuards, bump, invalidateApprovals, statusAfterChange, visibleAgreement } from './records'

export type FieldValue = string | number | boolean | null
export async function normalizedValue(c: Ctx, f: CustomField, value: unknown, checks: Sql[], agreementId?: string): Promise<FieldValue> {
  if (value === null || value === '') return null
  if (f.kind === 'yes_no') {
    if (typeof value !== 'boolean') fail('INVALID', `${f.name} needs yes or no.`)
    return value
  }
  if (f.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('INVALID', `${f.name} needs a finite number.`)
    return value
  }
  if (f.kind === 'money') return money({ value }, 'value')
  if (f.kind === 'date') return date({ value }, 'value')
  const result = text({ value }, 'value', f.kind === 'text' ? 4000 : 200)
  if (f.kind === 'pick_list' && !parse<string[]>(f.options).includes(result)) fail('INVALID', `${f.name} needs one of its configured choices.`)
  if (f.kind === 'person') {
    const check = sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active')", result)
    if (!await c.db.prepare(`SELECT 1 WHERE ${check.sql}`).bind(...check.params).first()) fail('INVALID', `${f.name} needs an active person.`)
    checks.push(check)
  }
  if (f.kind === 'counterparty') {
    // Resolve through the same scoped parties projection used by workspace state.
    const rows = (await c.db.prepare('SELECT id,party_id,restricted,requester_id,owner_id FROM lk_agreements WHERE party_id=?').bind(result).all<any>()).results
    const visible = []
    for (const row of rows) {
      const check = visibleSql(c.actor, row.id)
      if (await c.db.prepare(`SELECT 1 WHERE ${check.sql}`).bind(...check.params).first()) visible.push(check)
    }
    const party = await c.db.prepare('SELECT id FROM lk_parties WHERE id=? AND merged_into IS NULL').bind(result).first()
    if (!party || (rows.length && !visible.length)) fail('INVALID', `${f.name} needs a current counterparty you can access.`)
    checks.push(sql('EXISTS(SELECT 1 FROM lk_parties WHERE id=? AND merged_into IS NULL)', result))
    if (visible.length) checks.push(sql(`(${visible.map(v => v.sql).join(' OR ')})`, ...visible.flatMap(v => v.params)))
    else checks.push(sql('NOT EXISTS(SELECT 1 FROM lk_agreements WHERE party_id=?)', result))
  }
  return result
}
export async function customValueWrites(c: Ctx, agreementId: string, type: string, value: unknown, stage: string, existing = true) {
  const input = object(value ?? {}, 'values'), fields = await customFields(c.db), checks = customFieldChecks(fields)
  const prior = existing ? (await c.db.prepare('SELECT field_id,value FROM lk_custom_values WHERE agreement_id=?').bind(agreementId).all<{field_id:string;value:string}>()).results : []
  const final = new Map<string, FieldValue>(prior.map(v => [v.field_id, parse(v.value)]))
  const writes: Sql[] = [], edited: CustomField[] = []
  let allowed: Role[] = ['owner', 'counsel', 'approver', 'requester', 'viewer']
  for (const [id, raw] of Object.entries(input)) {
    const field = fields.find(f => f.id === id && fieldApplies(f, type))
    if (!field) fail('INVALID', 'Choose a custom field defined for this agreement type.')
    const roles = parse<Role[]>(field.edit_roles)
    requireRole(c.actor, roles, `edit ${field.name}`)
    allowed = allowed.filter(r => roles.includes(r))
    const normalized = await normalizedValue(c, field, raw, checks, agreementId)
    final.set(id, normalized); edited.push(field)
    writes.push(sql('INSERT INTO lk_custom_values VALUES(?,?,?,?,?) ON CONFLICT(agreement_id,field_id) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at', agreementId, id, json(normalized), c.actor.id, c.now))
    // A metadata correction never leaves an older cited family value current.
    writes.push(sql("UPDATE lk_terms SET status='superseded' WHERE agreement_id=? AND key=? AND status='confirmed'", agreementId, `custom:${id}`))
  }
  const missing = fields.filter(f => fieldApplies(f, type) && fieldRequired(f, stage) && (final.get(f.id) === null || final.get(f.id) === undefined))
  if (missing.length) fail('FIELDS', `Fill in: ${missing.map(f => f.name).join(', ')}.`, 409, { missing: missing.map(f => f.name) })
  return { writes, checks, allowed, edited, fields, values: Object.fromEntries(final) }
}
export async function requiredCustomFields(c: Ctx, agreementId: string, type: string, stage: string) {
  return (await customValueWrites(c, agreementId, type, {}, stage)).checks
}
const setValues: Handler = async (c, p) => {
  const a = await visibleAgreement(c, p.agreementId)
  const version = integer(p, 'expectedVersion', 1)
  if (a.version !== version) fail('STALE', 'This agreement changed. Reload before saving its fields.', 409)
  const result = await customValueWrites(c, a.id, a.type, p.values, a.status)
  if (!result.edited.length) fail('INVALID', 'Supply at least one custom field value.')
  return { allowed: result.allowed, result: { id: a.id }, checks: [...agreementGuards(c, a), ...result.checks],
    writes: [...result.writes, invalidateApprovals(c, a.id, 'Custom metadata changed'), bump(c, a, 'status=?', statusAfterChange(a))],
    audit: [{ action: 'field.values.set', agreementId: a.id, summary: `Recorded custom fields: ${result.edited.map(f => f.name).join(', ')}; earlier approvals withdrawn.` }] }
}
export const customValueHandlers: Record<string, Handler> = { 'field.values.set': setValues }
