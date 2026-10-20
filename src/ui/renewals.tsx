import { NoticeAgentSource } from './notice-agent'
import { BulkReminders } from './bulk-reminders'
import { NoticeDelivery } from './notice-delivery'
import { DeadlineReminderLog, DeadlineReminderSettings } from './deadline-reminders'
// Renewals on a calendar: a band of the coming months with each notice
// deadline pinned on it, then the renewals in date order; the chosen one opens
// in place with its two steps, the decision and the notice.
import { useState } from 'react'
import { type LocketState, type Row } from './api'
import type { Locket } from './app'
import { Badge, Empty, Field, Form, value, When } from './controls'
import { can, clock, day, daysUntil, deadline, partyName, personName } from './format'

const capital = (word: string) => word[0].toUpperCase() + word.slice(1)

export function Renewals({ state, locket }: { state: LocketState; locket: Locket }) {
  const renewals = [...state.renewals].sort((a, b) => a.deadline_at - b.deadline_at)
  const [selected, setSelected] = useState(renewals[0]?.id ?? '')
  return (
    <div className="lk-renewals">
      <div className="lk-titlebar"><div><h1>Renewals</h1><p className="lk-muted">Notice deadlines from confirmed terms, decisions, and notices approved and sent. A prepared or approved notice is not a sent notice.</p></div></div>
      <DeadlineReminderSettings state={state} locket={locket} />
      <BulkReminders state={state} locket={locket} />
      {renewals.length === 0 ? <section className="lk-panel"><Empty>No renewals yet. Confirm an end date and notice period on an executed agreement.</Empty></section> : (
        <>
          <Band state={state} renewals={renewals} selected={selected} />
          <ol className="lk-renewal-list">
            {renewals.map(r => {
              const a = state.agreements.find(x => x.id === r.agreement_id)!, days = daysUntil(r.deadline_at, state.now, r.timezone), open = r.id === selected
              const decision = r.decision ? <Badge value="approved" label={capital(r.decision)} /> : days <= 30 ? <Badge value="undetermined" label="Decide soon" /> : <Badge value="draft" label="Open" />
              return (
                <li key={r.id} className={`lk-renewal${open ? ' lk-open' : ''}`}>
                  <div className="lk-renewal-row">
                    <span className="lk-deadline">{deadline(r.deadline_at, r.timezone).split(',').slice(0, 2).join(',')}<small>{days < 0 ? `${-days} days overdue` : `in ${days} days`} · by {clock(r.deadline_at, r.timezone)}</small></span>
                    <span className="lk-renewal-title">
                      <button type="button" className="lk-linklike" aria-expanded={open} onClick={() => setSelected(r.id)}>{a.title}</button>
                      <small>{partyName(state, a.party_id)} · {a.reference} · term ends {day(r.end_date)}{r.auto_renew ? ', auto-renews' : ''} · {r.notice_days} days' notice</small>
                    </span>
                    {decision}
                  </div>
                  {open && <Steps state={state} r={r} a={a} locket={locket} />}
                </li>
              )
            })}
          </ol>
        </>
      )}
    </div>
  )
}

/** The coming months with every notice deadline pinned where it falls. */
function Band({ state, renewals, selected }: { state: LocketState; renewals: Row[]; selected: string }) {
  const start = new Date(state.now), first = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)
  const lastDeadline = Math.max(...renewals.map(r => r.deadline_at))
  const months: number[] = []
  for (let m = 0; m < 12 && (months.length < 4 || Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1) <= lastDeadline); m++) months.push(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1))
  const end = Date.UTC(new Date(months.at(-1)!).getUTCFullYear(), new Date(months.at(-1)!).getUTCMonth() + 1, 1)
  const at = (ms: number) => `${Math.min(100, Math.max(0, ((ms - first) / (end - first)) * 100))}%`
  return (
    <section className="lk-band" aria-label="Notice deadlines by month">
      <p className="lk-band-range">{[months[0], months.at(-1)!].map(m => new Date(m).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })).join(' – ')}</p>
      <div className="lk-band-months">{months.map(m => <span key={m}>{new Date(m).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}<span className="lk-band-year"> {new Date(m).getUTCFullYear()}</span></span>)}</div>
      <div className="lk-band-track">
        <span className="lk-band-today" style={{ left: at(state.now) }}><small>Today</small></span>
        {renewals.filter(r => r.deadline_at < end).map(r => {
          const a = state.agreements.find(x => x.id === r.agreement_id)
          return <span key={r.id} className={`lk-pin${r.id === selected ? ' lk-pin-active' : ''}${r.decision ? ' lk-pin-decided' : ''}`} style={{ left: at(r.deadline_at) }} title={`${a?.title}: notice by ${deadline(r.deadline_at, r.timezone)}`} aria-hidden="true" />
        })}
      </div>
    </section>
  )
}

function Steps({ state, r, a, locket }: { state: LocketState; r: Row; a: Row; locket: Locket }) {
  const { run, busy } = locket
  const notices = state.notices.filter(n => n.renewal_id === r.id).sort((x, y) => y.created_at - x.created_at)
  return (
    <div className="lk-steps">
      <section className="lk-card lk-step">
        <h3>1. Decision</h3>
        {r.decision ? <p className="lk-decided"><Badge value="approved" label={capital(r.decision)} /> <span className="lk-muted">by {personName(state, r.decided_by)} <When at={r.decided_at} />{r.decision_reason ? ` — ${r.decision_reason}` : ''}</span></p> : can(state, 'owner', 'approver') ? (
          <Form busy={busy} submit="Record decision" onSubmit={data => void run('renewal.decide', { renewalId: r.id, decision: value(data, 'decision'), reason: value(data, 'reason') || undefined })}>
            <div className="lk-segmented">{['renew', 'renegotiate', 'terminate'].map(d => <label key={d}><input type="radio" name="decision" value={d} defaultChecked={d === 'renew'} /> {capital(d)}</label>)}</div>
            <Field label="Internal note"><input name="reason" /></Field>
          </Form>
        ) : <p className="lk-muted">Waiting for the owner or an approver to decide.</p>}
        <a className="lk-text-link" href={`#agreement/${a.id}/terms`}>Open the agreement's terms</a>
      </section>
      <section className="lk-card lk-step" aria-label="Deadline reminders sent">
        <h3>Reminders</h3>
        <DeadlineReminderLog state={state} subjectId={r.id} />
      </section>
      <section className="lk-card lk-step">
        <h3>2. Notice</h3>
        {notices.length === 0 && <p className="lk-muted">No notice drafted.</p>}
        {notices.map(n => <NoticeDelivery key={n.id} state={state} notice={n} renewal={r} locket={locket} />)}
        <NoticeAgentSource state={state} renewal={r} agreement={a} locket={locket} />
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
    </div>
  )
}
