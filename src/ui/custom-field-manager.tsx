import { useState } from 'react'
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { parse, roleLabel, statusLabel, typeLabel } from './format'

const kinds: Record<string, string> = { text: 'Text', number: 'Number', money: 'USD money', date: 'Date', pick_list: 'Pick list', yes_no: 'Yes / no', person: 'Person', counterparty: 'Counterparty' }
const stages = ['draft', 'in_review', 'approved', 'out_for_signature', 'executed']
const roles = ['owner', 'counsel', 'approver', 'requester', 'viewer']

export function CustomFieldManager({ state, locket }: { state: LocketState; locket: Locket }) {
  const [selected, setSelected] = useState('')
  if (state.actor.role !== 'owner') return null
  const field = state.customFields.find(f => f.id === selected)
  return <section className="lk-panel" aria-label="Custom metadata settings">
    <div className="lk-panel-head"><h2>Custom metadata fields</h2></div>
    <p className="lk-muted">Define fields by agreement type, when they are required and which people may edit them.</p>
    <details className="lk-disclosure"><summary>Manage custom fields</summary>
      <Field label="Field to configure"><select value={selected} onChange={event => setSelected(event.target.value)}><option value="">New field</option>{state.customFields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
      <FieldDefinition key={`${field?.id ?? 'new'}:${field?.version ?? 0}`} field={field} locket={locket} onSaved={setSelected} />
    </details>
  </section>
}
function FieldDefinition({ field, locket, onSaved }: { field?: Row; locket: Locket; onSaved: (id: string) => void }) {
  const [kind, setKind] = useState(field?.kind ?? 'text')
  return <Form busy={locket.busy} submit={field ? 'Save field changes' : 'Create field'} onSubmit={async data => {
    const agreementTypes = data.getAll('agreementType').map(String)
    if (!agreementTypes.length) { locket.setError('Choose at least one agreement type.'); return }
    const result = await locket.run('field.save', { ...(field ? { id: field.id, version: field.version } : {}), name: value(data, 'name'), kind, agreementTypes, helpText: value(data, 'helpText'), requiredStages: data.getAll('requiredStage'), editRoles: data.getAll('editRole'), options: kind === 'pick_list' ? value(data, 'options').split('\n').map(s => s.trim()).filter(Boolean) : [] })
    if (result) onSaved(result.id)
  }}>
    <div className="lk-grid2">
      <Field label="Field name"><input name="name" required defaultValue={field?.name ?? ''} /></Field>
      <Field label="Field type" hint={field ? 'Type changes are refused once the field has recorded values.' : undefined}><select value={kind} onChange={event => setKind(event.target.value)}>{Object.entries(kinds).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
    </div>
    <Field label="Help text"><textarea name="helpText" rows={2} defaultValue={field?.help_text ?? ''} /></Field>
    {kind === 'pick_list' && <Field label="Pick list options" hint="One option per line."><textarea name="options" rows={4} required defaultValue={field ? parse<string[]>(field.options).join('\n') : ''} /></Field>}
    <fieldset className="lk-fieldset"><legend>Agreement types</legend><div className="lk-grid2">{Object.entries(typeLabel).map(([id, label]) => <label key={id} className="lk-check"><input name="agreementType" type="checkbox" value={id} defaultChecked={field ? parse<string[]>(field.agreement_types).includes(id) : true} /> {label}</label>)}</div></fieldset>
    <fieldset className="lk-fieldset"><legend>Required at stages</legend><div className="lk-grid2">{stages.map(stage => <label key={stage} className="lk-check"><input name="requiredStage" type="checkbox" value={stage} defaultChecked={field ? parse<string[]>(field.required_stages).includes(stage) : false} /> {statusLabel[stage]}</label>)}</div></fieldset>
    <fieldset className="lk-fieldset"><legend>Roles allowed to edit</legend><div className="lk-grid2">{roles.map(role => <label key={role} className="lk-check"><input name="editRole" type="checkbox" value={role} defaultChecked={field ? parse<string[]>(field.edit_roles).includes(role) : ['owner', 'counsel', 'approver', 'requester'].includes(role)} /> {roleLabel[role]}</label>)}</div></fieldset>
  </Form>
}
