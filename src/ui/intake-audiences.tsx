import { useState } from 'react'
import type { IntakeAudience } from '../locket/intake-audiences'
import type { LocketState } from './api'
import type { Locket } from './app'
import { Empty, Field, Form, value } from './controls'

type AudienceState = LocketState & { intakeAudiences: IntakeAudience[] }

/** Owner-managed membership used by intake forms' launch restrictions. */
export function IntakeAudiences({ state, locket }: { state: AudienceState; locket: Locket }) {
  const [selected, setSelected] = useState('')
  if (state.actor.role !== 'owner') return null
  const audience = state.intakeAudiences.find(item => item.id === selected)
  const personName = (id: string) => state.operators.find(person => person.id === id)?.name ?? id
  return <section className="lk-panel" aria-labelledby="lk-intake-audiences">
    <div className="lk-panel-head"><h2 id="lk-intake-audiences">Intake groups and departments</h2></div>
    <p>Choose who belongs to each group or department, then use it to limit who may launch an intake form.</p>
    {state.intakeAudiences.length ? <ul className="lk-rules">{state.intakeAudiences.map(item => <li key={item.id}>
      <strong>{item.name}</strong>
      <p>{item.kind === 'group' ? 'Group' : 'Department'} · {item.memberIds.length} {item.memberIds.length === 1 ? 'member' : 'members'}</p>
      <small>{item.memberIds.map(personName).join(', ') || 'No members assigned'}</small>
    </li>)}</ul> : <Empty>No intake groups or departments recorded.</Empty>}
    <details className="lk-disclosure">
      <summary>Manage intake membership</summary>
      <Field label="Group or department to configure"><select value={selected} onChange={event => setSelected(event.target.value)}>
        <option value="">New group or department</option>
        {state.intakeAudiences.map(item => <option key={item.id} value={item.id}>{item.name} ({item.kind})</option>)}
      </select></Field>
      <AudienceDefinition key={`${audience?.id ?? 'new'}:${audience?.version ?? 0}`} audience={audience} state={state} locket={locket} onSaved={setSelected} />
    </details>
  </section>
}

function AudienceDefinition({ audience, state, locket, onSaved }: { audience?: IntakeAudience; state: AudienceState; locket: Locket; onSaved: (id: string) => void }) {
  const people = state.operators.filter(person => person.status === 'active' || audience?.memberIds.includes(person.id))
  const inactiveIds = (audience?.memberIds ?? []).filter(id => !state.operators.some(person => person.id === id))
  return <Form busy={locket.busy} submit={audience ? 'Save membership changes' : 'Create group or department'} onSubmit={async data => {
    const result = await locket.run('audience.save', {
      ...(audience ? { id: audience.id, version: audience.version } : {}),
      name: value(data, 'name'), kind: value(data, 'kind'), memberIds: data.getAll('memberId').map(String),
    })
    if (result) onSaved(result.id)
  }}>
    <div className="lk-grid2">
      <Field label="Name"><input name="name" required maxLength={200} defaultValue={audience?.name ?? ''} /></Field>
      <Field label="Kind"><select name="kind" defaultValue={audience?.kind ?? 'group'}><option value="group">Group</option><option value="department">Department</option></select></Field>
    </div>
    <fieldset className="lk-fieldset"><legend>Members</legend>
      <p>Only active members can be saved. Remove any inactive members before saving changes.</p>
      {people.length || inactiveIds.length ? <div className="lk-grid2">
        {people.map(person => <label key={person.id} className="lk-check"><input type="checkbox" name="memberId" value={person.id} defaultChecked={audience?.memberIds.includes(person.id) ?? false} /> {person.name}{person.status !== 'active' ? ' (inactive)' : ''}</label>)}
        {inactiveIds.map(id => <label key={id} className="lk-check"><input type="checkbox" name="memberId" value={id} defaultChecked /> {id} (unavailable)</label>)}
      </div> : <Empty>No active members available.</Empty>}
    </fieldset>
  </Form>
}
