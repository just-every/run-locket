// RENEW-002 screens: the owner's reminder offsets, and on each renewal or
// obligation every reminder, escalation, digest and alternate retry with the
// provider's own events (accepted is not delivered).
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Badge, Field, Form, value } from './controls'
import { can, personName, when } from './format'

export function DeadlineReminderSettings({ state, locket }: { state: LocketState; locket: Locket }) {
  if (!can(state, 'owner')) return null
  return <section className="lk-panel" aria-label="Deadline reminder offsets">
    <div className="lk-panel-head"><h2>Deadline reminders</h2><span className="lk-muted">Emailed at 9:00 am in the recipient's time zone; an undecided renewal escalates to its approver and the owner 30 days before the deadline.</span></div>
    <Form busy={locket.busy} submit="Save reminder offsets" onSubmit={data => void locket.run('deadline.reminders.configure', { offsets: value(data, 'offsets').split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && String(n) !== '') })}>
      <Field label="Days before each deadline" hint="Comma separated, for example 90, 60, 30, 7."><input name="offsets" defaultValue={state.deadlineReminders.offsets.join(', ')} required /></Field>
    </Form>
  </section>
}

const label = (r: Row) => r.kind === 'escalation' ? `Escalation at ${r.offset_days} days` : r.kind === 'alternate' ? `Alternate retry of the ${r.offset_days}-day reminder` : `${r.offset_days}-day reminder`

export function DeadlineReminderLog({ state, subjectId }: { state: LocketState; subjectId: string }) {
  const rows = state.deadlineReminders.sent.filter(r => r.subject_id === subjectId)
  if (rows.length === 0) return <p className="lk-muted">No reminder has gone out yet.</p>
  const status = (r: Row) => r.status === 'in_digest' ? state.deadlineReminders.sent.find(d => d.id === r.digest_id)?.status ?? 'queued' : r.status
  const events = (r: Row) => state.deadlineReminders.events.filter(e => e.reminder_id === r.id || e.reminder_id === r.digest_id)
  return <ul className="lk-log" aria-label="Reminders sent">{rows.map(r => (
    <li key={r.id}><time>{when(r.due_at)}</time><span>{label(r)} to {personName(state, r.recipient_id)} ({r.recipient_reason}){r.status === 'in_digest' ? ' in the daily digest' : ''} <Badge value={status(r)} />{events(r).map(e => <Badge key={e.id} value={e.status} tone={['bounced', 'failed', 'complained'].includes(e.status) ? 'bad' : 'neutral'} label={`Provider: ${e.status}`} />)}</span></li>
  ))}</ul>
}
