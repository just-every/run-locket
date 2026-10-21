import { requireRole } from './access'
import type { Handler } from './commands'
import { fail, integer, json, list, oneOf, optionalText, parse, sql, text, type Role } from './model'

export const fieldKinds = ['text', 'number', 'money', 'date', 'pick_list', 'yes_no', 'person', 'counterparty'] as const
export const fieldStages = ['draft', 'in_review', 'approved', 'out_for_signature', 'executed'] as const
export const fieldRoles: Role[] = ['owner', 'counsel', 'approver', 'requester', 'viewer']
const types = ['customer', 'supplier', 'nda', 'amendment', 'order_form', 'other'] as const
export interface CustomField {
  id: string; name: string; kind: typeof fieldKinds[number]; agreement_types: string; help_text: string
  required_stages: string; edit_roles: string; options: string; version: number
}
export const customFields = async (db: D1Database): Promise<CustomField[]> =>
  (await db.prepare('SELECT * FROM lk_custom_fields ORDER BY name,id').all<CustomField>()).results
export const fieldApplies = (f: CustomField, type: string) => parse<string[]>(f.agreement_types).includes(type)
export const fieldRequired = (f: CustomField, stage: string) => {
  const index = stage === 'imported' ? 4 : fieldStages.indexOf(stage as typeof fieldStages[number])
  return index >= 0 && parse<string[]>(f.required_stages).some(s => fieldStages.indexOf(s as typeof fieldStages[number]) <= index)
}
export function customFieldChecks(fields: CustomField[]) {
  // Fences additions as well as edits while a stage decision is in flight.
  return [sql('(SELECT count(*) FROM lk_custom_fields)=?', fields.length), ...fields.map(f => sql('EXISTS(SELECT 1 FROM lk_custom_fields WHERE id=? AND version=?)', f.id, f.version))]
}
const values = (p: Record<string, unknown>, key: string, allowed: readonly string[], required = false) => {
  const result = list(p, key, allowed.length).map(v => oneOf({ value: v }, 'value', allowed))
  if ((required && !result.length) || new Set(result).size !== result.length) fail('INVALID', `${key} must contain distinct choices${required ? ' and cannot be empty' : ''}.`)
  return result
}
const save: Handler = async (c, p) => {
  requireRole(c.actor, ['owner'], 'define custom fields')
  const fields = await customFields(c.db)
  const prior = p.id === undefined ? null : fields.find(f => f.id === text(p, 'id', 100))
  if (p.id !== undefined && !prior) fail('NOT_FOUND', 'No custom field has that identity.', 404)
  if (prior && prior.version !== integer(p, 'version', 1)) fail('STALE', 'This field definition changed. Reload before editing.', 409)
  const id = prior?.id ?? crypto.randomUUID(), name = text(p, 'name', 100), kind = oneOf(p, 'kind', fieldKinds)
  const agreementTypes = values(p, 'agreementTypes', types, true), stages = values(p, 'requiredStages', fieldStages)
  const roles = values(p, 'editRoles', fieldRoles, true)
  const options = list(p, 'options', 100).map(v => text({ value: v }, 'value', 200))
  if (kind === 'pick_list' && (!options.length || new Set(options).size !== options.length)) fail('INVALID', 'Pick lists need distinct options.')
  if (kind !== 'pick_list' && options.length) fail('INVALID', 'Only pick lists have options.')
  const checks = customFieldChecks(fields)
  if (prior) {
    // A definition never silently reinterprets an existing recorded value.
    const used = await c.db.prepare('SELECT 1 FROM lk_custom_values WHERE field_id=? LIMIT 1').bind(id).first()
    const shapeChanged = prior.kind !== kind || prior.agreement_types !== json(agreementTypes) || prior.options !== json(options)
    if (used && shapeChanged) fail('FIELD_IN_USE', 'A field with recorded values keeps its type, agreement types and pick options. Define a new field for a different meaning.', 409)
    if (shapeChanged) checks.push(sql('NOT EXISTS(SELECT 1 FROM lk_custom_values WHERE field_id=?)', id))
  }
  const args = [name, kind, json(agreementTypes), optionalText(p, 'helpText', 2000) ?? '', json(stages), json(roles), json(options)]
  return { allowed: ['owner'], result: { id, version: (prior?.version ?? 0) + 1 }, checks,
    writes: prior ? [sql('UPDATE lk_custom_fields SET name=?,kind=?,agreement_types=?,help_text=?,required_stages=?,edit_roles=?,options=?,version=version+1,updated_at=? WHERE id=?', ...args, c.now, id)]
      : [sql('INSERT INTO lk_custom_fields VALUES(?,?,?,?,?,?,?,?,1,?,?,?)', id, ...args, c.actor.id, c.now, c.now)],
    audit: [{ action: 'field.save', summary: `${prior ? 'Updated' : 'Defined'} custom field ${name}.` }] }
}
export const customFieldHandlers: Record<string, Handler> = { 'field.save': save }
