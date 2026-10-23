import { ApprovalChannelSettings } from './approval-channel-settings'
import { useState } from 'react'
import type { LocketState } from './api'
import type { Locket } from './app'
import { Badge, Empty, Field, Form, value } from './controls'
import { stamp, words } from './format'
import { zones } from './preferences'

const kindLabel: Record<string,string> = {draft_retention:'Expired draft needs owner review',rule_approval:'Rule approval request',rule_approval_reminder:'Rule approval reminder',rule_approval_escalation:'Rule approval escalation', queue_assignment:'Request assignment',queue_due_soon:'Queue due soon',queue_overdue:'Queue overdue',queue_canceled:'Request canceled',queue_reopened:'Request reopened', assignment: 'Assignment', mention: 'Comment mention', approval: 'Approval request', signature: 'Signature event', deadline: 'Deadline reminder' }
const emailLabel: Record<string, string> = {
  pending: 'Email queued',
  queued: 'Email queued',
  deferred: 'Email waiting for daily digest',
  digest: 'Email waiting for daily digest',
  sending: 'Email in progress or interrupted; acceptance unconfirmed',
  accepted: 'Email provider accepted; delivery unconfirmed',
  suppressed: 'Email suppressed; nothing sent',
  rejected: 'Email rejected by provider',
  rate_limited: 'Email rate limited; not accepted',
  uncertain: 'Email outcome unknown; acceptance unconfirmed',
  cancelled: 'Email cancelled; nothing sent',
}

export function Notifications({ state, locket }: { state: LocketState; locket: Locket }) {
  const { preferences, items } = state.notifications
  const [unreadOnly, setUnreadOnly] = useState(false)
  const unread = items.filter(item => item.read_at === null).length
  const shown = items.filter(item => !unreadOnly || item.read_at === null).sort((a, b) => b.created_at - a.created_at)
  return <div className="lk-stack">
    <ApprovalChannelSettings state={state} locket={locket} personalOnly/>
    <div className="lk-titlebar"><div><h1>Notifications</h1><p className="lk-muted">Assignments, mentions, approvals, signature events and deadlines for agreements you can access.</p></div></div>
    <section className="lk-panel" aria-label="Notification inbox">
      <div className="lk-panel-head"><h2>Inbox</h2><span className="lk-muted">{unread} unread</span></div>
      <div className="lk-filters">
        <button type="button" className={`lk-filter${!unreadOnly ? ' lk-selected' : ''}`} aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>All <strong>{items.length}</strong></button>
        <button type="button" className={`lk-filter${unreadOnly ? ' lk-selected' : ''}`} aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>Unread <strong>{unread}</strong></button>
      </div>
      {shown.length === 0 ? <Empty>{unreadOnly ? 'No unread notifications.' : 'No notifications yet.'}</Empty> : shown.map(item => <article className="lk-card" key={item.id} aria-label={`${kindLabel[item.kind]} notification`}>
        <div className="lk-finding-head"><h3>{kindLabel[item.kind]}</h3><Badge value={item.read_at === null ? 'pending' : 'done'} label={item.read_at === null ? 'Unread' : 'Read'} /></div>
        <small>{stamp(item.created_at, { zone: preferences.timezone, year: true })}</small>
        <p>{emailLabel[item.email_status] ?? `Email status: ${words(item.email_status)}`}</p>
        <a href={item.link} className="lk-text-link">Open agreement</a>
        {item.read_at === null && <button type="button" className="lk-small" disabled={locket.busy} onClick={() => void locket.run('notification.read', { id: item.id })}>Mark as read</button>}
      </article>)}
    </section>
    {state.actor.role !== 'agent' && <section className="lk-panel" aria-label="Notification preferences">
      <div className="lk-panel-head"><h2>Your notification preferences</h2><span className="lk-muted">These preferences apply to your account.</span></div>
      <Form key={JSON.stringify(preferences)} busy={locket.busy} submit="Save notification preferences" onSubmit={async data => { await locket.run('notification.preferences', { inApp: data.get('inApp') === 'on', email: data.get('email') === 'on', digest: data.get('digest') === 'on', timezone: value(data, 'timezone') }) }}>
        <label className="lk-check"><input type="checkbox" name="inApp" defaultChecked={preferences.inApp} /> In-app notifications</label>
        <label className="lk-check"><input type="checkbox" name="email" defaultChecked={preferences.email} /> Email notifications</label>
        <label className="lk-check"><input type="checkbox" name="digest" defaultChecked={preferences.digest} /> Daily email digest</label>
        <Field label="Notification time zone" hint="The daily digest uses your chosen time zone. Email must be enabled to receive it."><select name="timezone" defaultValue={preferences.timezone}>{zones.map(([id, label]) => <option key={id} value={id}>{label} ({id})</option>)}</select></Field>
      </Form>
    </section>}
  </div>
}
