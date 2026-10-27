import type { LocketState } from './api'
import { Badge, Empty } from './controls'
import { day, partyName, words } from './format'

export function OwnerObligations({ state }: { state: LocketState }) {
  const rows = state.ownerObligations
  return <div className="lk-tab-page">
    <div className="lk-titlebar"><div><h1>My obligations</h1><p className="lk-muted">Confirmed assignments you can currently access. Completed and waived occurrences stay in history.</p></div></div>
    <section className="lk-panel" aria-label="My obligation list">
      {rows.length === 0 ? <Empty>No confirmed obligations assigned to you.</Empty> : <ul className="lk-obligations">{rows.map(o => {
        const a = state.agreements.find(a => a.id === o.agreement_id)!
        return <li key={o.id} data-obligation-id={o.id}>
          <div className="lk-finding-head"><a href={`#agreement/${a.id}/terms`}><strong>{o.description}</strong></a><Badge value={o.lifecycle_status} /></div>
          <p>{a.title} · {partyName(state, a.party_id)}</p>
          <dl className="lk-obligation-facts">
            <div><dt>Occurrence due</dt><dd>{day(o.due_date)}</dd></div>
            <div><dt>Repeats</dt><dd>{o.recurrence === 'none' ? 'Once' : words(o.recurrence)}</dd></div>
            <div><dt>Next due</dt><dd>{day(o.next_due_date)}</dd></div>
          </dl>
          {o.waiver_reason && <p>Waiver reason: {o.waiver_reason}</p>}
        </li>
      })}</ul>}
    </section>
  </div>
}
