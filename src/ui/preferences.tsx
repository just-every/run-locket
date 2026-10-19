// Each person's US time zone, approval delegate, daily digest and alternate
// recipient (APPROVE-004, RENEW-002). People set their own; the owner sets anyone's.
import { useState } from 'react'
import type { LocketState } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { can, personName } from './format'

export const zones: [string, string][] = [['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'], ['America/Phoenix', 'Arizona'], ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii']]

export function Preferences({ state, locket }: { state: LocketState; locket: Locket }) {
  const owner = can(state, 'owner')
  const members = state.operators.filter(o => o.status === 'active' && o.role !== 'agent')
  const people = owner ? members : members.filter(o => o.id === state.actor.id)
  const [chosen, setChosen] = useState(people[0]?.id ?? '')
  if (can(state, 'agent') || people.length === 0) return null
  const person = people.find(o => o.id === chosen) ?? people[0]
  const mine = state.approvalReminders.preferences.find(p => p.operator_id === person.id)
  const commercial = members.filter(o => ['owner', 'approver'].includes(o.role))
  return <section className="lk-panel" aria-label="Reminder preferences">
    <div className="lk-panel-head"><h2>Reminder preferences</h2><span className="lk-muted">Reminders arrive at 9:00 am in this time zone; without one, in the deadline's own zone (approval business days use Eastern).</span></div>
    <Form key={person.id} busy={locket.busy} submit="Save preferences" onSubmit={data => void locket.run('preferences.set', { operatorId: person.id, timezone: value(data, 'timezone'), delegateId: value(data, 'delegateId') || null, digest: data.get('digest') === 'on', alternateId: value(data, 'alternateId') || null })}>
      {owner && <Field label="Person"><select value={person.id} onChange={e => setChosen(e.target.value)}>{people.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>}
      <Field label="Time zone"><select name="timezone" defaultValue={mine?.timezone ?? 'America/New_York'}>{zones.map(([id, label]) => <option key={id} value={id}>{label} ({id})</option>)}</select></Field>
      {['owner', 'approver'].includes(person.role) && <Field label="Approval delegate" hint="Receives the escalation when an approval waits too long."><select name="delegateId" defaultValue={mine?.delegate_id ?? ''}><option value="">No delegate</option>{commercial.filter(o => o.id !== person.id).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>}
      <Field label="Alternate recipient" hint="Receives a deadline reminder to this person that bounced."><select name="alternateId" defaultValue={mine?.alternate_id ?? ''}><option value="">The responsible person, else the owner</option>{members.filter(o => o.id !== person.id).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
      <label className="lk-check"><input type="checkbox" name="digest" defaultChecked={!!mine?.digest} /> Daily digest: one email a day with every deadline reminder that came due</label>
    </Form>
    {owner && state.approvalReminders.preferences.length > 0 && <ul className="lk-list">{state.approvalReminders.preferences.map(p => <li key={p.operator_id}><span><strong>{personName(state, p.operator_id)}</strong> · {zones.find(z => z[0] === p.timezone)?.[1] ?? p.timezone} · delegate {p.delegate_id ? personName(state, p.delegate_id) : 'none'} · {p.digest ? 'daily digest' : 'each reminder'} · alternate {p.alternate_id ? personName(state, p.alternate_id) : 'default'}</span></li>)}</ul>}
  </section>
}
