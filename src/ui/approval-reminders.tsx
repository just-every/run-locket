// APPROVE-004 screens: who each pending approval waits on, when they are next
// reminded and escalated, "Remind approver", and the owner's intervals and each
// approver's time zone and delegate.
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Badge, Empty, Field, Form, value } from './controls'
import { can, deadline, personName, plural, when } from './format'

const zones: [string, string][] = [['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'], ['America/Phoenix', 'Arizona'], ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii']]
const reason: Record<string, string> = { delegate: 'delegate', escalation_contact: 'escalation contact', owner: 'owner' }
const receipt: Record<string, string> = {
  accepted: 'The mail provider accepted the reminder. Mailbox delivery is unconfirmed.',
  suppressed: 'Reminder suppressed in local development or demo. No email was sent.',
  rejected: 'The mail provider did not accept the reminder.',
  rate_limited: 'The mail provider rate limited the reminder. No acceptance is confirmed.',
  uncertain: 'The mail provider outcome is unknown. This reminder will not be sent again automatically.',
  cancelled: 'The reminder was not sent because the approval or the approver changed. Reload records.',
}

export function ApprovalReminders({ state, a, locket }: { state: LocketState; a: Row; locket: Locket }) {
  const pending = state.approvalReminders.pending.filter(p => p.agreementId === a.id)
  const sent = state.approvalReminders.sent.filter(r => r.agreement_id === a.id)
  if (a.status !== 'in_review' && sent.length === 0) return null
  const working = can(state, 'owner', 'counsel', 'approver', 'requester')
  return <section className="lk-panel" aria-label="Approval reminders">
    <div className="lk-panel-head"><h2>Approval reminders</h2></div>
    {pending.length === 0 ? <Empty>No approval request is waiting. Email an approval link to name an approver; Locket then reminds them on business days.</Empty> : (
      <ul className="lk-route">{pending.map(p => {
        const escalated = sent.find(r => r.kind === 'escalation' && r.approver_id === p.approverId && r.version_id === p.versionId)
        const count = sent.filter(r => r.kind !== 'escalation' && r.approver_id === p.approverId && r.version_id === p.versionId).length
        const blocked = p.manualAvailableAt && p.manualAvailableAt > state.now
        return <li key={p.approverId}>
          <div>
            <strong>Waiting on {personName(state, p.approverId)}</strong>
            <small>Requested {when(p.requestedAt)} · {plural(count, 'reminder')} so far</small>
            <small>Next reminder {deadline(p.nextReminderAt, p.timezone)}</small>
            <small>{escalated ? `Escalated to ${personName(state, escalated.recipient_id)} (${reason[escalated.recipient_reason]})` : `Escalates ${deadline(p.escalateAt, p.timezone)}`}</small>
          </div>
          {working && (blocked ? <small>Reminded recently. Next manual reminder from {when(p.manualAvailableAt)}.</small> : (
            <button type="button" disabled={locket.busy} onClick={async () => {
              const out = await locket.run('approval.remind', { agreementId: a.id, version: a.version, approverId: p.approverId })
              if (out) locket.setNotice(receipt[out.mailReceipt?.status] ?? 'Reminder acceptance has not been confirmed.')
            }}>Remind approver</button>
          ))}
        </li>
      })}</ul>
    )}
    {sent.length > 0 && <ul className="lk-log">{sent.map(r => <li key={r.id}><time>{when(r.created_at)}</time><span>{r.kind === 'escalation' ? `Escalation to ${personName(state, r.recipient_id)} (${reason[r.recipient_reason]})` : `${r.kind === 'manual' ? 'Manual reminder' : `Reminder ${r.slot}`} to ${personName(state, r.recipient_id)}`} <Badge value={r.status} /></span></li>)}</ul>}
  </section>
}

export function ReminderSettings({ state, locket }: { state: LocketState; locket: Locket }) {
  const { settings, preferences } = state.approvalReminders
  const owner = can(state, 'owner')
  if (!can(state, 'owner', 'approver')) return null
  const commercial = state.operators.filter(o => o.status === 'active' && ['owner', 'approver'].includes(o.role))
  const people = owner ? commercial : commercial.filter(o => o.id === state.actor.id)
  const mine = preferences.find(p => p.operator_id === (people[0]?.id ?? ''))
  return <section className="lk-panel" aria-label="Approval reminder settings">
    <div className="lk-panel-head"><h2>Approval reminders</h2><span className="lk-muted">Business days are Monday to Friday in the approver's time zone, skipping US federal holidays. Locket checks every hour.</span></div>
    {owner && <Form busy={locket.busy} submit="Save reminder intervals" onSubmit={data => void locket.run('approval.reminders.configure', { firstAfterDays: Number(value(data, 'firstAfterDays')), repeatEveryDays: Number(value(data, 'repeatEveryDays')), escalateAfterDays: Number(value(data, 'escalateAfterDays')), escalationContactId: value(data, 'escalationContactId') || null })}>
      <h3>Reminder intervals</h3>
      <Field label="First reminder after (business days)"><input name="firstAfterDays" type="number" min={1} max={30} defaultValue={settings.firstAfterDays} required /></Field>
      <Field label="Then every (business days)"><input name="repeatEveryDays" type="number" min={1} max={30} defaultValue={settings.repeatEveryDays} required /></Field>
      <Field label="Escalate after (business days)"><input name="escalateAfterDays" type="number" min={1} max={60} defaultValue={settings.escalateAfterDays} required /></Field>
      <Field label="Escalation contact" hint="Used when the approver has no delegate who can decide; otherwise the owner."><select name="escalationContactId" defaultValue={settings.escalationContactId ?? ''}><option value="">The owner</option>{commercial.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
    </Form>}
    {people.length > 0 && <Form busy={locket.busy} submit="Save approval preferences" onSubmit={data => void locket.run('approval.preferences.set', { operatorId: value(data, 'operatorId'), timezone: value(data, 'timezone'), delegateId: value(data, 'delegateId') || null })}>
      <h3>Approver time zone and delegate</h3>
      <Field label="Approver"><select name="operatorId">{people.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
      <Field label="Time zone"><select name="timezone" defaultValue={mine?.timezone ?? 'America/New_York'}>{zones.map(([id, label]) => <option key={id} value={id}>{label} ({id})</option>)}</select></Field>
      <Field label="Delegate" hint="Receives the escalation when an approval waits too long."><select name="delegateId" defaultValue={mine?.delegate_id ?? ''}><option value="">No delegate</option>{commercial.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
    </Form>}
    {owner && preferences.length > 0 && <ul className="lk-list">{preferences.map(p => <li key={p.operator_id}><span><strong>{personName(state, p.operator_id)}</strong> · {zones.find(z => z[0] === p.timezone)?.[1] ?? p.timezone} · delegate {p.delegate_id ? personName(state, p.delegate_id) : 'none'}</span></li>)}</ul>}
  </section>
}
