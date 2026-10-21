import { fileToPayload, type LocketState } from './api'
import { Field } from './controls'

export type IntakeCondition = { field: string; op: 'eq' | 'gt' | 'gte' | 'lt' | 'lte'; value: string }
export type IntakeField = {
  key: string; label: string; kind: 'text' | 'number' | 'money' | 'date' | 'pick_list' | 'person' | 'counterparty' | 'file'
  required: boolean; options: string[]; when?: IntakeCondition[]
}
export type IntakeRoute = { ownerId: string; reviewerId: string; approvalRole: 'approver' | 'counsel' }
export type IntakeFormDefinition = {
  name: string; type: string; fields: IntakeField[]; requirements: string[]
  launch: { roles: string[]; audienceIds: string[] }; defaultRoute: IntakeRoute
  rules: { name: string; when: IntakeCondition[]; route: IntakeRoute; requirements: string[] }[]
}
export type IntakeAnswers = Record<string, string | File>

// Only a display aid. The command handler independently decides visibility and routing.
export function formVisibleFields(definition: IntakeFormDefinition, answers: IntakeAnswers): IntakeField[] {
  const visible: IntakeField[] = []
  const known: IntakeAnswers = { type: definition.type, value: answers.value ?? '', department: answers.department ?? '', region: answers.region ?? '' }
  for (const field of definition.fields) {
    if (!(field.when ?? []).every(condition => {
      const answer = known[condition.field]
      if (typeof answer !== 'string' || !answer.trim()) return false
      if (condition.op === 'eq') {
        const numeric = condition.field==='value' || definition.fields.some(f=>f.key===condition.field && ['number','money'].includes(f.kind))
        return numeric ? compareDecimals(answer,condition.value)===0 : answer===condition.value
      }
      const comparison = compareDecimals(answer, condition.value)
      if (comparison === null) return false
      return condition.op === 'gt' ? comparison > 0 : condition.op === 'gte' ? comparison >= 0 : condition.op === 'lt' ? comparison < 0 : comparison <= 0
    })) continue
    visible.push(field)
    if (answers[field.key] !== undefined) known[field.key] = answers[field.key]
  }
  return visible
}

function compareDecimals(left: string, right: string): number | null {
  const values = [left, right].map(value => /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value.trim()))
  if (!values[0] || !values[1]) return null
  const places = Math.max(values[0][3]?.length ?? 0, values[1][3]?.length ?? 0)
  const scaled = values.map(match => BigInt(`${match![1] === '-' ? '-' : ''}${match![2]}${(match![3] ?? '').padEnd(places, '0')}`))
  return scaled[0] === scaled[1] ? 0 : scaled[0] > scaled[1] ? 1 : -1
}

/** Pass the currently visible field definitions so hidden answers stay out of a request. */
export async function readIntakeFormAnswers(answers: IntakeAnswers, fields?: IntakeField[]) {
  const allowed = fields ? new Set(['value', 'department', 'region', ...fields.map(field => field.key)]) : null
  const entries = await Promise.all(Object.entries(answers).filter(([key]) => !allowed || allowed.has(key)).map(async ([key, answer]) => [key, typeof answer === 'string' ? answer : await fileToPayload(answer)] as const))
  return Object.fromEntries(entries)
}

/** Controlled controls for the visible fields of a published form or a draft preview. */
export function IntakeFormFields({ fields, answers, onChange, state }: {
  fields: IntakeField[]; answers: IntakeAnswers; onChange: (key: string, answer: string | File) => void; state: LocketState
}) {
  return <>{fields.map(field => {
    const answer = typeof answers[field.key] === 'string' ? answers[field.key] as string : ''
    const common = { name: `intake.${field.key}`, required: field.required }
    const selected = (options: { id: string; name: string }[]) => <select {...common} value={answer} onChange={event => onChange(field.key, event.target.value)}><option value="">Choose…</option>{options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select>
    return <Field key={field.key} label={`${field.label}${field.required ? ' *' : ''}`} hint={field.kind === 'money' ? 'US dollars, with up to two decimal places.' : undefined}>
      {field.kind === 'pick_list' ? selected(field.options.map(option => ({ id: option, name: option })))
        : field.kind === 'person' ? selected(state.operators.filter(person => person.status === 'active').map(person => ({ id: person.id, name: person.name })))
          : field.kind === 'counterparty' ? selected(state.parties.filter(party => !party.merged_into).map(party => ({ id: party.id, name: party.name })))
            : field.kind === 'file' ? <input {...common} type="file" onChange={event => onChange(field.key, event.target.files?.[0] ?? '')} />
              : <input {...common} type={field.kind === 'date' ? 'date' : field.kind === 'number' ? 'number' : 'text'} step={field.kind === 'number' ? 'any' : undefined} inputMode={field.kind === 'money' ? 'decimal' : undefined} pattern={field.kind === 'money' ? '[0-9]+(\\.[0-9]{1,2})?' : undefined} value={answer} onChange={event => onChange(field.key, event.target.value)} />}
    </Field>
  })}</>
}
