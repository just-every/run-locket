import { NoticeAgentPlan } from './notice-agent'
import { useState } from 'react'
import { fileToPayload, type LocketState, type Row } from './api'
import type { Locket } from './app'
import { Badge, Field, Form, value, When } from './controls'
import { can, deadline, personName } from './format'

const dispatchLabels: Record<string, string> = {
  queued: 'Email queued, not sent', sending: 'Email sending, outcome pending',
  accepted: 'Email accepted by provider', suppressed: 'Email suppressed, not sent',
  rate_limited: 'Provider rate limited email, not sent', rejected: 'Provider rejected email, not sent', uncertain: 'Email outcome uncertain', cancelled: 'Email cancelled, not sent',
}

export function NoticeDelivery({ state, notice: n, renewal: r, locket }: { state: LocketState; notice: Row; renewal: Row; locket: Locket }) {
  const { run, busy } = locket
  const letter = state.noticeLetters.find(x => x.id === n.id)
  const plan = state.noticePlans.find(x => x.id === n.id)
  const dispatch = state.noticeDispatches.find(x => x.notice_id === n.id)
  const tracking = state.noticeTracking.find(x => x.id === n.id)
  const events = state.noticeEvents.filter(x => x.notice_id === n.id).sort((a, b) => a.occurred_at - b.occurred_at)
  const maySend = can(state, 'owner', 'approver', 'requester')
  const tracked = n.status === 'sent' && ['post', 'courier'].includes(n.sent_method)
  return (
    <article className="lk-notice" style={{ overflowWrap: 'anywhere', minWidth: 0 }}>
      <div className="lk-finding-head"><strong>To {n.recipient}</strong><Badge value={n.status} label={n.status === 'sent' ? 'Sent' : n.status === 'approved' ? 'Approved, not sent' : 'Draft'} /></div>
      <pre className="lk-document">{n.body}</pre>
      <small>Prepared by {personName(state, n.prepared_by)}{n.proposal_id ? ' (agent proposal)' : ''}{n.approved_by && <> · approved by {personName(state, n.approved_by)} <When at={n.approved_at} /></>}</small>
      {letter && <div><p><a className="lk-text-link" href={`/api/locket/files/${letter.artifact_id}`} download>Download PDF letter</a> · frozen recipient: {letter.recipient}</p><p className="lk-muted">PDF SHA-256: <code style={{ overflowWrap: 'anywhere' }}>{letter.sha256}</code></p></div>}
      {n.status === 'draft' && !letter && can(state, 'owner', 'counsel', 'approver', 'requester') && <button type="button" disabled={busy} onClick={() => void run('notice.letter', { noticeId: n.id })}>Prepare PDF letter</button>}
      <NoticeAgentPlan state={state} notice={n} renewal={r} locket={locket} />
      {!plan && n.status === 'draft' && letter && can(state, 'owner', 'approver') && <button type="button" className="lk-primary" disabled={busy} onClick={() => void run('notice.approve', { noticeId: n.id })}>Approve for sending</button>}
      {dispatch && <div><p><Badge value={dispatch.status} tone={['rejected', 'uncertain'].includes(dispatch.status) ? 'warn' : 'neutral'} label={dispatchLabels[dispatch.status] ?? dispatch.status} /> {dispatch.status === 'accepted' && events.length === 0 && <span>Delivery unconfirmed. </span>}{dispatch.provider}{dispatch.provider_message_id && <> · message ID: <code>{dispatch.provider_message_id}</code></>}{dispatch.code && <> · {dispatch.code}</>}</p>{dispatch.pdf_sha256 && <p className="lk-muted">Dispatched PDF SHA-256: <code style={{ overflowWrap: 'anywhere' }}>{dispatch.pdf_sha256}</code></p>}</div>}
      {n.status === 'approved' && maySend && (!plan || plan.status === 'ready') && <>
        {!plan && letter && !dispatch && <button type="button" className="lk-primary" disabled={busy} onClick={() => void run('notice.email', { noticeId: n.id })}>Send approved PDF by email</button>}
        {!letter && <p className="lk-muted">This approved notice has no frozen PDF letter. Provider email sending is unavailable.</p>}
        {!dispatch && <ManualSending notice={n} locket={locket} approvedMethod={plan?.method} />}
      </>}
      {n.status === 'sent' && <p>Sent by {n.sent_method} on <span className="lk-nowrap">{deadline(n.sent_at, r.timezone)}</span>{n.sent_recorded_by && <> (recorded by {personName(state, n.sent_recorded_by)})</>}{n.evidence_artifact_id && <> · <a href={`/api/locket/files/${n.evidence_artifact_id}`} download>evidence</a></>}</p>}
      {tracked && <div>
        <p><Badge value={tracking?.status === 'delivered' ? 'confirmed' : 'pending'} label={tracking?.status === 'delivered' ? 'Manually recorded delivered' : 'Sent, delivery unconfirmed'} />{tracking?.tracking_number && <> · Tracking: {tracking.tracking_number}</>}{tracking?.delivered_at && <> · <When at={tracking.delivered_at} /></>}</p>
        {tracking?.detail && <p>{tracking.detail}</p>}
        {maySend && tracking?.status !== 'delivered' && <Form busy={busy} submit="Record delivered evidence" onSubmit={async data => { await run('notice.tracking', { noticeId: n.id, trackingNumber: value(data, 'trackingNumber'), status: 'delivered', deliveredAt: new Date(value(data, 'deliveredAt')).toISOString(), detail: value(data, 'detail') }) }}>
          <Field label="Certified mail or courier tracking number"><input name="trackingNumber" defaultValue={tracking?.tracking_number ?? ''} required /></Field>
          <Field label="Delivered at"><input type="datetime-local" name="deliveredAt" required /></Field>
          <Field label="Delivery evidence note"><textarea name="detail" rows={2} required /></Field>
        </Form>}
      </div>}
      {events.length > 0 && <ul>{events.map(event => <li key={event.id}>{event.source === 'provider' ? `Provider reported ${event.status}` : `Manually recorded ${event.status}`} · <When at={event.occurred_at} />{event.source === 'manual' && event.detail && <> · {event.detail}</>}</li>)}</ul>}
      <p className="lk-muted">Sending and delivery evidence do not decide whether notice is legally effective; counsel makes that decision.</p>
    </article>
  )
}

function ManualSending({ notice, locket, approvedMethod }: { notice: Row; locket: Locket; approvedMethod?: string }) {
  const [method, setMethod] = useState(approvedMethod ?? 'email')
  const tracked = ['post', 'courier'].includes(method)
  return <Form busy={locket.busy} submit="Record that it was sent" onSubmit={async data => {
    const evidence = data.get('evidence') as File | null
    await locket.run('notice.sent', { noticeId: notice.id, method: value(data, 'method'), sentAt: new Date(value(data, 'sentAt')).toISOString(), trackingNumber: tracked ? value(data, 'trackingNumber') : undefined, evidence: evidence?.size ? await fileToPayload(evidence) : undefined })
  }}>
    <div className="lk-grid2">
      <Field label="Sent by"><select name="method" value={method} onChange={event => setMethod(event.target.value)}><option value="email">Email</option><option value="post">Mail</option><option value="courier">Courier</option><option value="hand">By hand</option><option value="portal">Portal</option></select></Field>
      <Field label="Sent at"><input type="datetime-local" name="sentAt" required /></Field>
    </div>
    {tracked && <Field label="Certified mail or courier tracking number"><input name="trackingNumber" required /></Field>}
    <Field label="Evidence (sent email, receipt)"><input type="file" name="evidence" /></Field>
  </Form>
}
