import { useState } from 'react'
import type { LocketState } from './api'
import type { Locket } from './app'
import { Field, Form, Panel } from './controls'
import { roleLabel, typeLabel } from './format'
import { IntakeFormFields, formVisibleFields, type IntakeAnswers, type IntakeCondition, type IntakeField, type IntakeFormDefinition, type IntakeRoute } from './intake-form-fields'

export type IntakeFormRecord = { id: string; name: string; type: string; version: number; published_version_id: string | null; definition: IntakeFormDefinition; published?: { id: string; number: number; definition: IntakeFormDefinition } }
export type IntakeAudience = { id: string; name: string; kind: string; version: number; memberIds: string[] }
type DesignerState = LocketState & { intakeForms: IntakeFormRecord[]; intakeAudiences: IntakeAudience[] }
type Preview = { fields: IntakeField[]; requirements: string[]; route: IntakeRoute; matchedRule: string | null }
const kinds: Record<IntakeField['kind'], string> = { text: 'Text', number: 'Number', money: 'USD money', date: 'Date', pick_list: 'Pick list', person: 'Person', counterparty: 'Counterparty', file: 'File' }
const roles = ['owner', 'counsel', 'approver', 'requester']
const lines = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean)
const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(item => item !== value) : [...values, value]
const freshField = (fields: IntakeField[]): IntakeField => {
  let index = fields.length + 1
  while (fields.some(field => field.key === `answer_${index}`)) index++
  return { key: `answer_${index}`, label: '', kind: 'text', required: false, options: [] }
}

export function IntakeFormDesigner({ state: workspace, locket }: { state: LocketState; locket: Locket }) {
  const state = workspace as DesignerState
  const [selected, setSelected] = useState('')
  if (!['owner', 'counsel'].includes(state.actor.role)) return null
  const record = state.intakeForms.find(form => form.id === selected)
  return <Panel title="Request form designer">
    <p className="lk-muted">Create request questions, required attachments and routing rules. Save a draft, preview sample requests, then publish it for the selected people.</p>
    <Field label="Form to configure"><select value={selected} disabled={locket.busy} onChange={event => setSelected(event.target.value)}><option value="">New form</option>{state.intakeForms.map(form => <option key={form.id} value={form.id}>{form.name}{form.published_version_id ? ' · published' : ' · draft'}</option>)}</select></Field>
    <DefinitionEditor key={record?.id ?? 'new'} state={state} locket={locket} record={record} onCreated={setSelected} />
  </Panel>
}

function DefinitionEditor({ state, locket, record, onCreated }: { state: DesignerState; locket: Locket; record?: IntakeFormRecord; onCreated: (id: string) => void }) {
  const [definition, setDefinition] = useState<IntakeFormDefinition>(() => record?.definition ?? {
    name: '', type: 'supplier', fields: [], requirements: [], launch: { roles: [], audienceIds: [] }, rules: [],
    defaultRoute: { ownerId: state.actor.id, reviewerId: state.operators.find(person => person.status === 'active' && person.role === 'counsel')?.id ?? '', approvalRole: 'approver' },
  })
  const [revision, setRevision] = useState(record?.version)
  const [dirty, setDirty] = useState(!record)
  const [answers, setAnswers] = useState<IntakeAnswers>({ value: '', department: '', region: '' })
  const [preview, setPreview] = useState<Preview | null>(null)
  const [published, setPublished] = useState(false)
  const edit = (next: IntakeFormDefinition) => { setDefinition(next); setDirty(true); setPreview(null); setPublished(false) }
  const changeAnswer = (key: string, answer: string | File) => { setAnswers(current => ({ ...current, [key]: answer })); setPreview(null) }
  const updateField = (index: number, field: IntakeField) => edit({ ...definition, fields: definition.fields.map((item, at) => at === index ? field : item) })
  const updateRule = (index: number, rule: IntakeFormDefinition['rules'][number]) => edit({ ...definition, rules: definition.rules.map((item, at) => at === index ? rule : item) })
  const moveRule = (index: number, direction: number) => {
    const rules = [...definition.rules]
    ;[rules[index], rules[index + direction]] = [rules[index + direction], rules[index]]
    edit({ ...definition, rules })
  }
  return <fieldset className="lk-fieldset" style={{minWidth:0}} disabled={locket.busy}>
    {record?.published && <p className="lk-muted">Published version {record.published.number}. Changes stay in the draft until published. Existing requests keep their original route.</p>}
    <Form busy={locket.busy} submit="Save draft" onSubmit={async () => {
      const cleaned = { ...definition, requirements: lines(definition.requirements.join('\n')), fields: definition.fields.map(field => ({ ...field, options: lines(field.options.join('\n')) })), rules: definition.rules.map(rule => ({ ...rule, requirements: lines(rule.requirements.join('\n')) })) }
      const result = await locket.run('form.save', { ...(record ? { id: record.id, version: revision } : {}), definition: cleaned })
      if (result) { setRevision(result.version); setDirty(false); setPreview(null); if (!record) onCreated(result.id) }
    }}>
      <div className="lk-grid2" style={{gridTemplateColumns:"repeat(auto-fit, minmax(min(210px, 100%), 1fr))"}}>
        <Field label="Form name"><input required value={definition.name} onChange={event => edit({ ...definition, name: event.target.value })} /></Field>
        <Field label="Agreement type"><select value={definition.type} onChange={event => edit({ ...definition, type: event.target.value })}>{Object.entries(typeLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
      </div>
      <fieldset className="lk-fieldset" style={{minWidth:0}}><legend>Request questions</legend>
        <p className="lk-muted">Agreement value, department and region are available to every form. Add any other answers here.</p>
        {definition.fields.map((field, index) => <FieldEditor key={index} field={field} index={index} definition={definition} state={state} onChange={next => updateField(index, next)} onRemove={() => edit({ ...definition, fields: definition.fields.filter((_, at) => at !== index) })} />)}
        <button type="button" onClick={() => edit({ ...definition, fields: [...definition.fields, freshField(definition.fields)] })}>Add question</button>
      </fieldset>
      <Field label="Required attachments" hint="One document name per line. Matching routing rules can require additional documents."><textarea rows={3} value={definition.requirements.join('\n')} onChange={event => edit({ ...definition, requirements: event.target.value.split('\n') })} /></Field>
      <fieldset className="lk-fieldset" style={{minWidth:0}}><legend>Default route</legend><RouteEditor route={definition.defaultRoute} state={state} onChange={route => edit({ ...definition, defaultRoute: route })} /></fieldset>
      <fieldset className="lk-fieldset" style={{minWidth:0}}><legend>Routing rules in priority order</legend>
        <p className="lk-muted">The first matching rule replaces the default route and adds its required attachments. All conditions in a rule must match.</p>
        {definition.rules.map((rule, index) => <fieldset className="lk-fieldset" style={{minWidth:0}} key={index}><legend>Rule {index + 1}</legend>
          <Field label={`Rule ${index + 1} name`}><input required value={rule.name} onChange={event => updateRule(index, { ...rule, name: event.target.value })} /></Field>
          <Conditions conditions={rule.when} definition={definition} state={state} onChange={when => updateRule(index, { ...rule, when })} />
          <RouteEditor route={rule.route} state={state} onChange={route => updateRule(index, { ...rule, route })} />
          <Field label={`Rule ${index + 1} additional attachments`} hint="One document name per line."><textarea rows={2} value={rule.requirements.join('\n')} onChange={event => updateRule(index, { ...rule, requirements: event.target.value.split('\n') })} /></Field>
          <div className="lk-form-actions"><button type="button" disabled={index === 0} onClick={() => moveRule(index, -1)}>Move earlier</button><button type="button" disabled={index === definition.rules.length - 1} onClick={() => moveRule(index, 1)}>Move later</button><button type="button" onClick={() => edit({ ...definition, rules: definition.rules.filter((_, at) => at !== index) })}>Remove rule</button></div>
        </fieldset>)}
        <button type="button" onClick={() => edit({ ...definition, rules: [...definition.rules, { name: '', when: [{ field: 'value', op: 'gt', value: '50000' }], route: { ...definition.defaultRoute }, requirements: [] }] })}>Add routing rule</button>
      </fieldset>
      <fieldset className="lk-fieldset" style={{minWidth:0}}><legend>Who can launch this form</legend>
        <p className="lk-muted">Any selected role, group or department grants launch access. To limit access to a group, select that group and leave the roles unchecked.</p>
        <div className="lk-grid2" style={{gridTemplateColumns:"repeat(auto-fit, minmax(min(210px, 100%), 1fr))"}}>{roles.map(role => <label className="lk-check" key={role}><input type="checkbox" checked={definition.launch.roles.includes(role)} onChange={() => edit({ ...definition, launch: { ...definition.launch, roles: toggle(definition.launch.roles, role) } })} />{roleLabel[role]}</label>)}</div>
        <div className="lk-grid2" style={{gridTemplateColumns:"repeat(auto-fit, minmax(min(210px, 100%), 1fr))"}}>{state.intakeAudiences.map(audience => <label className="lk-check" key={audience.id}><input type="checkbox" checked={definition.launch.audienceIds.includes(audience.id)} onChange={() => edit({ ...definition, launch: { ...definition.launch, audienceIds: toggle(definition.launch.audienceIds, audience.id) } })} />{audience.name} ({audience.kind})</label>)}</div>
        {!state.intakeAudiences.length && <p className="lk-muted">Create a group or department to limit launching by membership.</p>}
      </fieldset>
    </Form>
    <fieldset className="lk-fieldset" style={{minWidth:0}}><legend>Preview a sample request</legend>
      <p className="lk-muted">Save your draft before previewing. Change the sample value to compare routes on either side of a threshold.</p>
      <Form busy={locket.busy || dirty || !record} submit="Preview sample" onSubmit={async () => {
        if (!record || dirty) return
        const visible = formVisibleFields(definition, answers)
        const keys = new Set(['value', 'department', 'region', ...visible.map(field => field.key)])
        const sample = Object.fromEntries(Object.entries(answers).filter(([key]) => keys.has(key)).map(([key, answer]) => [key, typeof answer === 'string' ? answer : answer.name]))
        const result = await locket.run('form.preview', { id: record.id, version: revision, answers: sample })
        if (result) setPreview(result)
      }}>
        <div className="lk-grid2" style={{gridTemplateColumns:"repeat(auto-fit, minmax(min(210px, 100%), 1fr))"}}>
          <Field label="Sample agreement value (USD)"><input inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" value={String(answers.value ?? '')} onChange={event => changeAnswer('value', event.target.value)} /></Field>
          <Field label="Sample department"><select value={String(answers.department ?? '')} onChange={event => changeAnswer('department', event.target.value)}><option value="">No department</option>{state.intakeAudiences.filter(audience => audience.kind === 'department').map(audience => <option key={audience.id} value={audience.id}>{audience.name}</option>)}</select></Field>
          <Field label="Sample region"><input value={String(answers.region ?? '')} onChange={event => changeAnswer('region', event.target.value)} /></Field>
        </div>
        <IntakeFormFields fields={formVisibleFields(definition, answers).map(field => ({ ...field, required: false }))} answers={answers} onChange={changeAnswer} state={state} />
      </Form>
      {preview && <div role="status"><h3>Sample route</h3><p>{preview.matchedRule ? `Matched rule: ${preview.matchedRule}` : 'Default route'}</p><dl><dt>Responsible person</dt><dd>{state.operators.find(person => person.id === preview.route.ownerId)?.name ?? 'Unavailable person'}</dd><dt>Reviewer</dt><dd>{state.operators.find(person => person.id === preview.route.reviewerId)?.name ?? 'Unavailable person'}</dd><dt>Approval role</dt><dd>{roleLabel[preview.route.approvalRole]}</dd></dl><h3>Required documents</h3>{preview.requirements.length ? <ul>{preview.requirements.map((requirement, index) => <li key={index}>{requirement}</li>)}</ul> : <p>No additional documents required.</p>}<h3>Visible questions</h3>{preview.fields.length ? <ul>{preview.fields.map(field => <li key={field.key}>{field.label}{field.required ? ' (required)' : ''}</li>)}</ul> : <p>No additional questions.</p>}</div>}
      <div className="lk-form-actions"><button type="button" className="lk-primary" disabled={locket.busy || dirty || !record || !preview || published} onClick={async () => { if (record) { const result = await locket.run('form.publish', { id: record.id, version: revision }); if (result) { setRevision(result.version); setPublished(true) } } }}>Publish form</button></div>
      {published && <p role="status">Form published. Selected people can now launch this version.</p>}
    </fieldset>
  </fieldset>
}

function RouteEditor({ route, state, onChange }: { route: IntakeRoute; state: LocketState; onChange: (route: IntakeRoute) => void }) {
  const people = state.operators.filter(person => person.status === 'active' && ['owner', 'counsel', 'approver', 'requester'].includes(person.role))
  return <div className="lk-grid2" style={{gridTemplateColumns:"repeat(auto-fit, minmax(min(210px, 100%), 1fr))"}}>
    <Field label="Responsible person"><select required value={route.ownerId} onChange={event => onChange({ ...route, ownerId: event.target.value })}><option value="">Choose a person</option>{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
    <Field label="Reviewer"><select required value={route.reviewerId} onChange={event => onChange({ ...route, reviewerId: event.target.value })}><option value="">Choose a reviewer</option>{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
    <Field label="Approval role"><select value={route.approvalRole} onChange={event => onChange({ ...route, approvalRole: event.target.value as IntakeRoute['approvalRole'] })}><option value="approver">Commercial approver</option><option value="counsel">Counsel</option></select></Field>
  </div>
}

function FieldEditor({ field, index, definition, state, onChange, onRemove }: { field: IntakeField; index: number; definition: IntakeFormDefinition; state: DesignerState; onChange: (field: IntakeField) => void; onRemove: () => void }) {
  return <fieldset className="lk-fieldset" style={{minWidth:0}}><legend>Question {index + 1}</legend><div className="lk-grid2" style={{gridTemplateColumns:"repeat(auto-fit, minmax(min(210px, 100%), 1fr))"}}>
    <Field label={`Question ${index + 1} label`}><input required value={field.label} onChange={event => onChange({ ...field, label: event.target.value })} /></Field>
    <Field label={`Question ${index + 1} answer name`} hint="A unique name using lowercase letters, numbers and underscores. Keep it stable when revising a form."><input required pattern="[a-z][a-z0-9_]*" value={field.key} onChange={event => onChange({ ...field, key: event.target.value })} /></Field>
    <Field label={`Question ${index + 1} type`}><select value={field.kind} onChange={event => onChange({ ...field, kind: event.target.value as IntakeField['kind'], options: [] })}>{Object.entries(kinds).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></Field>
  </div>
    <label className="lk-check"><input type="checkbox" checked={field.required} onChange={event => onChange({ ...field, required: event.target.checked })} />Required when visible</label>
    {field.kind === 'pick_list' && <Field label={`Question ${index + 1} options`} hint="One option per line."><textarea required rows={3} value={field.options.join('\n')} onChange={event => onChange({ ...field, options: event.target.value.split('\n') })} /></Field>}
    <p className="lk-muted">Show this question when all conditions match. With no conditions, it is always shown.</p>
    <Conditions conditions={field.when ?? []} definition={{ ...definition, fields: definition.fields.slice(0, index) }} state={state} exclude={field.key} onChange={when => onChange({ ...field, when })} />
    <button type="button" onClick={onRemove}>Remove question</button>
  </fieldset>
}

function Conditions({ conditions, definition, state, exclude, onChange }: { conditions: IntakeCondition[]; definition: IntakeFormDefinition; state: DesignerState; exclude?: string; onChange: (conditions: IntakeCondition[]) => void }) {
  const fields = [{ key: 'type', label: 'Agreement type', kind: 'type' }, { key: 'value', label: 'Agreement value (USD)', kind: 'money' }, { key: 'department', label: 'Department', kind: 'department' }, { key: 'region', label: 'Region', kind: 'text' }, ...definition.fields.filter(field => field.key !== exclude && field.kind !== 'file')]
  const edit = (index: number, condition: IntakeCondition) => onChange(conditions.map((item, at) => at === index ? condition : item))
  return <>
    {conditions.map((condition, index) => {
      const field = fields.find(item => item.key === condition.field)
      const numeric = field?.kind === 'number' || field?.kind === 'money'
      const options = field?.kind === 'type' ? Object.entries(typeLabel).map(([id, name]) => ({ id, name })) : field?.kind === 'department' ? state.intakeAudiences.filter(audience => audience.kind === 'department') : field?.kind === 'person' ? state.operators.filter(person => person.status === 'active') : field?.kind === 'counterparty' ? state.parties.filter(party => !party.merged_into) : field?.kind === 'pick_list' ? definition.fields.find(item => item.key === field.key)!.options.map(option => ({ id: option, name: option })) : null
      return <fieldset className="lk-fieldset" style={{minWidth:0}} key={index}><legend>Condition {index + 1}</legend><div className="lk-grid2" style={{gridTemplateColumns:"repeat(auto-fit, minmax(min(210px, 100%), 1fr))"}}>
        <Field label="Answer to compare"><select value={condition.field} onChange={event => edit(index, { field: event.target.value, op: 'eq', value: '' })}>{!field && <option value={condition.field}>Unavailable answer ({condition.field})</option>}{fields.map(item => <option key={item.key} value={item.key}>{item.label || item.key}</option>)}</select></Field>
        <Field label="Comparison"><select value={condition.op} onChange={event => edit(index, { ...condition, op: event.target.value as IntakeCondition['op'] })}><option value="eq">Is equal to</option>{numeric && <><option value="gt">Is greater than</option><option value="gte">Is at least</option><option value="lt">Is less than</option><option value="lte">Is at most</option></>}</select></Field>
        <Field label="Comparison value">{options ? <select required value={condition.value} onChange={event => edit(index, { ...condition, value: event.target.value })}><option value="">Choose…</option>{options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select> : <input required type={field?.kind === 'date' ? 'date' : 'text'} inputMode={numeric ? 'decimal' : undefined} value={condition.value} onChange={event => edit(index, { ...condition, value: event.target.value })} />}</Field>
      </div><button type="button" onClick={() => onChange(conditions.filter((_, at) => at !== index))}>Remove condition</button></fieldset>
    })}
    <div className="lk-form-actions"><button type="button" onClick={() => onChange([...conditions, { field: 'value', op: 'gt', value: '50000' }])}>Add condition</button></div>
  </>
}
