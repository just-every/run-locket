import type { LocketState, Row } from './api'
import { Field } from './controls'
import { money, parse, partyName, personName, statusLabel, termLabel, termValue, words } from './format'

export const customFieldsFor = (state: LocketState, type: string) => state.customFields.filter(f => !state.fieldAccess.hidden.includes('custom:'+f.id)&&parse<string[]>(f.agreement_types).includes(type))
export const mayEditField = (state: LocketState, field: Row) => !state.fieldAccess.documentsWithheld && state.actor.role !== 'agent' && parse<string[]>(field.edit_roles).includes(state.actor.role)
export const storedCustomValues = (state: LocketState, agreementId: string) => Object.fromEntries(state.customValues.filter(v => v.agreement_id === agreementId).map(v => [v.field_id, parse(v.value)]))
export function customValueLabel(state: LocketState, field: Row, value: unknown, stored = true): string {
  if (value == null || value === '') return '—'
  if (field.kind === 'money') return stored ? `${money(Number(value))} USD` : `${value} USD`
  if (field.kind === 'yes_no') return value === true ? 'Yes' : 'No'
  if (field.kind === 'person') return personName(state, String(value))
  if (field.kind === 'counterparty') return partyName(state, String(value))
  return String(value)
}
export function metadataTermLabel(state: LocketState, key: string) {
  return key.startsWith('custom:') ? state.customFields.find(f => `custom:${f.id}` === key)?.name ?? 'Custom field unavailable' : termLabel[key] ?? words(key)
}
export function metadataTermValue(state: LocketState, key: string, value: string) {
  if (!key.startsWith('custom:')) return termValue(key, value)
  const field = state.customFields.find(f => `custom:${f.id}` === key)
  return field ? customValueLabel(state, field, parse(value)) : '—'
}
/** Money remains a decimal-dollar string at the command door. Other values
 * preserve their real primitive type; an empty choice explicitly clears it. */
export function readCustomValues(data: FormData, fields: Row[]) {
  const values: Record<string, string | number | boolean | null> = {}
  for (const field of fields) {
    const raw = data.get(`custom.${field.id}`)
    if (raw === null) continue
    const text = String(raw).trim()
    values[field.id] = text === '' ? null : field.kind === 'number' ? Number(text) : field.kind === 'yes_no' ? text === 'true' : text
  }
  return values
}
function decimalDollars(cents: number) {
  const absolute = Math.abs(cents)
  return `${cents < 0 ? '-' : ''}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}
/** Submit only actual edits, so saving an unrelated field keeps a cited
 * confirmed value and its family governing selection intact. */
export function changedCustomValues(data: FormData, fields: Row[], stored: Record<string, unknown>) {
  const values = readCustomValues(data, fields)
  const canonicalMoney = (value: string) => {
    const [whole, fraction = ''] = value.replace(/^-/, '').split('.')
    const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
    return (value.startsWith('-') ? -cents : cents).toString()
  }
  return Object.fromEntries(Object.entries(values).filter(([id, next]) => {
    const field = fields.find(f => f.id === id)!
    const prior = stored[id] ?? null
    if (field.kind === 'money' && next !== null && prior !== null) return canonicalMoney(String(next)) !== canonicalMoney(decimalDollars(Number(prior)))
    return next !== prior
  }))
}
export function CustomFieldInputs({ state, fields, values = {}, stage, stored = true, editable = true, proposal = false }: { state: LocketState; fields: Row[]; values?: Record<string, unknown>; stage?: string; stored?: boolean; editable?: boolean; proposal?: boolean }) {
  return <>{fields.map(field => {
    const stages = parse<string[]>(field.required_stages)
    const order = ['draft', 'in_review', 'approved', 'out_for_signature', 'executed']
    const rank = order.indexOf(stage === 'imported' ? 'executed' : stage ?? '')
    const required = rank >= 0 && stages.some(s => order.indexOf(s) <= rank)
    const hint = [field.help_text, stages.length ? `Required at: ${stages.map(s => statusLabel[s] ?? words(s)).join(', ')}.` : ''].filter(Boolean).join(' ')
    const raw = values[field.id]
    const selected = raw == null ? '' : field.kind === 'money' && stored ? decimalDollars(Number(raw)) : String(raw)
    const common = { name: `custom.${field.id}`, defaultValue: selected, required }
    if (!editable || (!proposal && !mayEditField(state, field))) return <div className="lk-field" key={field.id}><strong>{field.name}</strong><span>{customValueLabel(state, field, raw, stored)}</span>{hint && <small>{hint}</small>}<small>Your role cannot edit this field.</small></div>
    const choices = field.kind === 'yes_no' ? [{ id: 'true', label: 'Yes' }, { id: 'false', label: 'No' }]
      : field.kind === 'pick_list' ? parse<string[]>(field.options).map(option => ({ id: option, label: option }))
      : field.kind === 'person' ? state.operators.filter(o => o.status === 'active' && o.role !== 'agent').map(o => ({ id: o.id, label: o.name }))
      : field.kind === 'counterparty' ? state.parties.filter(p => !p.merged_into).map(p => ({ id: p.id, label: p.name })) : null
    return <Field key={field.id} label={`${field.name}${field.kind === 'money' ? ' (USD)' : ''}${required ? ' *' : ''}`} hint={hint || undefined}>
      {choices ? <select {...common}><option value="">Not set</option>{selected && !choices.some(choice => choice.id === selected) && <option value={selected} disabled>Previously selected value</option>}{choices.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select>
        : <input {...common} type={field.kind === 'date' ? 'date' : field.kind === 'number' ? 'number' : 'text'} step={field.kind === 'number' ? 'any' : undefined} inputMode={['number', 'money'].includes(field.kind) ? 'decimal' : undefined} pattern={field.kind === 'money' ? '[0-9]+([.][0-9]{1,2})?' : undefined} />}
    </Field>
  })}</>
}
