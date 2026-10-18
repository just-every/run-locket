import { useState } from 'react'
import { fileToPayload, type LocketState } from './api'
import type { Locket } from './app'
import { Badge, Empty, Field, Form, value, When } from './controls'
import { Engraved } from './engraved'
import { can, day, deadline, partyName, personName } from './format'

const DAY = 86_400_000
const capital = (word: string) => word[0].toUpperCase() + word.slice(1)

export function Renewals({ state, locket }: { state: LocketState; locket: Locket }) {
  const { run, busy } = locket
  const renewals = [...state.renewals].sort((a, b) => a.deadline_at - b.deadline_at)
  const [selected, setSelected] = useState(renewals[0]?.id ?? '')
  const r = renewals.find(x => x.id === selected) ?? renewals[0]
  const a = r ? state.agreements.find(x => x.id === r.agreement_id) : null
  const notices = r ? state.notices.filter(n => n.renewal_id === r.id).sort((x, y) => y.created_at - x.created_at) : []
  const due = (ms: number) => Math.ceil((ms - state.now) / DAY)
  return (
    <div className="lk-renewals">
      <div className="lk-titlebar"><div><h1>Renewals</h1><p className="lk-muted">Notice deadlines from confirmed terms, decisions, and notices approved and sent. A prepared or approved notice is not a sent notice.</p></div></div>
      <div className="lk-split">
        <section className="lk-panel lk-table-panel">
          <div className="lk-panel-head"><h2>Upcoming notice deadlines</h2><span className="lk-count">{renewals.length}</span></div>
          {renewals.length === 0 ? <Empty>No renewals yet. Confirm an end date and notice period on an executed agreement.</Empty> : (
            <table className="lk-table">
              <thead><tr><th>Agreement</th><th>Counterparty</th><th>Notice deadline (local)</th><th>Term ends</th><th>Decision</th></tr></thead>
              <tbody>{renewals.map(x => {
                const ag = state.agreements.find(y => y.id === x.agreement_id)!, days = due(x.deadline_at)
                const decision = x.decision ? <Badge value="approved" label={capital(x.decision)} /> : days <= 30 ? <Badge value="undetermined" label="Decide soon" /> : <Badge value="draft" label="Open" />
                return (
                  <tr key={x.id} className={x.id === r?.id ? 'lk-selected' : undefined} onClick={() => setSelected(x.id)}>
                    <td data-label="Agreement"><span className="lk-record-head"><button type="button" className="lk-linklike" onClick={() => setSelected(x.id)}>{ag.title}</button><span className="lk-record-status">{decision}</span></span><small>{ag.reference}</small></td>
                    <td data-label="Counterparty">{partyName(state, ag.party_id)}</td>
                    <td data-label="Notice deadline (local)"><span className="lk-deadline">{deadline(x.deadline_at, x.timezone)}<small>{x.timezone} · {days < 0 ? `${-days} days overdue` : `in ${days} days`}</small></span></td>
                    <td data-label="Term ends">{day(x.end_date)}{x.auto_renew ? <small>auto-renews</small> : null}</td>
                    <td data-label="Decision">{decision}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          )}
        </section>
        {r && a && (
          <aside className="lk-panel lk-side">
            <div className="lk-side-head"><h2>{a.title}</h2></div>
            <a className="lk-text-link" href={`#agreement/${a.id}/terms`}>Open agreement</a>
            <Engraved className="lk-renewal-facts">
              <dl className="lk-facts">
                <div><dt>Term ends</dt><dd>{day(r.end_date)}</dd></div>
                <div><dt>Notice period</dt><dd>{r.notice_days} days</dd></div>
                <div className="lk-fact-wide"><dt>Notice deadline</dt><dd>{deadline(r.deadline_at, r.timezone)}<small>{r.timezone}</small></dd></div>
              </dl>
            </Engraved>
            <section className="lk-card lk-step">
            <h3>1. Decision</h3>
            {r.decision ? <p className="lk-decided"><Badge value="approved" label={capital(r.decision)} /> <span className="lk-muted">by {personName(state, r.decided_by)} <When at={r.decided_at} />{r.decision_reason ? ` — ${r.decision_reason}` : ''}</span></p> : can(state, 'owner', 'approver') ? (
              <Form busy={busy} submit="Record decision" onSubmit={data => void run('renewal.decide', { renewalId: r.id, decision: value(data, 'decision'), reason: value(data, 'reason') || undefined })}>
                <div className="lk-segmented">{['renew', 'renegotiate', 'terminate'].map(d => <label key={d}><input type="radio" name="decision" value={d} defaultChecked={d === 'renew'} /> {d[0].toUpperCase() + d.slice(1)}</label>)}</div>
                <Field label="Internal note"><input name="reason" /></Field>
              </Form>
            ) : <p className="lk-muted">Waiting for the owner or an approver to decide.</p>}
            </section>
            <section className="lk-card lk-step">
            <h3>2. Notice</h3>
            {notices.length === 0 && <Empty>No notice drafted.</Empty>}
            {notices.map(n => (
              <article key={n.id} className="lk-notice">
                <div className="lk-finding-head"><strong>To {n.recipient}</strong><Badge value={n.status === 'sent' ? 'sent' : n.status === 'approved' ? 'approved' : 'draft'} label={n.status === 'sent' ? 'Sent' : n.status === 'approved' ? 'Approved, not sent' : 'Draft'} /></div>
                <pre className="lk-document">{n.body}</pre>
                <small>Prepared by {personName(state, n.prepared_by)}{n.proposal_id ? ' (agent proposal)' : ''}{n.approved_by && <> · approved by {personName(state, n.approved_by)} <When at={n.approved_at} /></>}</small>
                {n.status === 'sent' && <p>Sent by {n.sent_method} on <span className="lk-nowrap">{deadline(n.sent_at, r.timezone)}</span> ({r.timezone}, recorded by {personName(state, n.sent_recorded_by)}){n.evidence_artifact_id && <> · <a href={`/api/locket/files/${n.evidence_artifact_id}`} download>evidence</a></>}</p>}
                {n.status === 'draft' && can(state, 'owner', 'approver') && <button type="button" className="lk-primary" disabled={busy} onClick={() => void run('notice.approve', { noticeId: n.id })}>Approve for sending</button>}
                {n.status === 'approved' && can(state, 'owner', 'approver', 'requester') && (
                  <Form busy={busy} submit="Record that it was sent" onSubmit={async data => {
                    const evidence = data.get('evidence') as File | null
                    await run('notice.sent', { noticeId: n.id, method: value(data, 'method'), sentAt: new Date(value(data, 'sentAt')).toISOString(), evidence: evidence?.size ? await fileToPayload(evidence) : undefined })
                  }}>
                    <div className="lk-grid2">
                      <Field label="Sent by"><select name="method"><option value="email">Email</option><option value="post">Mail</option><option value="courier">Courier</option><option value="hand">By hand</option><option value="portal">Portal</option></select></Field>
                      <Field label="Sent at"><input type="datetime-local" name="sentAt" required /></Field>
                    </div>
                    <Field label="Evidence (sent email, receipt)"><input type="file" name="evidence" /></Field>
                  </Form>
                )}
              </article>
            ))}
            {r.decision && can(state, 'owner', 'counsel', 'approver', 'requester') && (
              <details className="lk-disclosure">
                <summary>Draft a notice</summary>
                <Form busy={busy} submit="Save draft" onSubmit={async (data, form) => { if (await run('notice.prepare', { renewalId: r.id, recipient: value(data, 'recipient'), body: value(data, 'body') })) form.reset() }}>
                  <Field label="Recipient"><input name="recipient" required /></Field>
                  <Field label="Notice text"><textarea name="body" rows={5} required /></Field>
                </Form>
              </details>
            )}
            </section>
          </aside>
        )}
      </div>
    </div>
  )
}
