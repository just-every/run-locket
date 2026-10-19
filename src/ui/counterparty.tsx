// A counterparty's page: its details, the agreements this person may see, its
// open obligations and the risk they roll up to (OBL-002). Entity details,
// merging and linked CRM records are REPO-010.
import type { LocketState, Row } from './api'
import { Badge, Empty, Icon, Person } from './controls'
import { day, money, personName, statusLabel, typeLabel, words } from './format'

const riskWord = (risk: string) => words(risk)

/** An obligation's rating, and the raised rating while it is overdue. */
export function RiskLabel({ state, o }: { state: LocketState; o: Row }) {
  const r = state.risk.obligations[o.id]
  if (!r) return <>{riskWord(o.risk)}</>
  return <>{riskWord(r.risk)}{r.overdue && <small> raised from {r.rated}: overdue</small>}</>
}

const rolled = (r: { risk: string; overdue: number } | null | undefined) => (r ? `${riskWord(r.risk)}${r.overdue ? ` (raised: ${r.overdue} overdue obligation${r.overdue === 1 ? '' : 's'})` : ''}` : 'No open obligations')

export function Counterparty({ state, id }: { state: LocketState; id: string }) {
  const party = state.parties.find(p => p.id === id)
  if (!party) return <Empty>No counterparty you can see has that identity.</Empty>
  const agreements = state.agreements.filter(a => a.party_id === id)
  const open = state.obligations.filter(o => o.status === 'confirmed' && agreements.some(a => a.id === o.agreement_id))
  return (
    <div className="lk-tab-page">
      <a className="lk-back" href="#agreements"><Icon name="back" />Back to agreements</a>
      <div className="lk-titlebar"><div><h1>{party.name}</h1><p className="lk-muted">{words(party.kind)}{party.tax_id ? ` · ${party.tax_id_kind === 'ein' ? 'EIN' : 'Tax ID'} ${party.tax_id}` : ''}{party.email ? ` · ${party.email}` : ''}</p></div></div>
      <section className="lk-panel" aria-labelledby="lk-party-risk">
        <div className="lk-panel-head"><h2 id="lk-party-risk">Obligation risk</h2></div>
        <p data-party-risk={state.risk.parties[id]?.risk ?? 'none'}>Risk: {rolled(state.risk.parties[id])}</p>
        {open.length === 0 ? <Empty>No open obligations.</Empty> : (
          <ul className="lk-obligations">{open.map(o => (
            <li key={o.id}>
              <div className="lk-finding-head"><strong>{o.description}</strong><Badge value={state.risk.obligations[o.id]?.overdue ? 'overdue' : o.status} /></div>
              <dl className="lk-obligation-facts">
                <div><dt>Agreement</dt><dd><a href={`#agreement/${o.agreement_id}/terms`}>{agreements.find(a => a.id === o.agreement_id)?.title}</a></dd></div>
                <div><dt>Owner</dt><dd><Person name={personName(state, o.owner_id)} /></dd></div>
                <div><dt>Due</dt><dd>{day(o.due_date)}</dd></div>
                <div><dt>Risk</dt><dd><RiskLabel state={state} o={o} /></dd></div>
              </dl>
            </li>
          ))}</ul>
        )}
      </section>
      <section className="lk-panel" aria-labelledby="lk-party-agreements">
        <div className="lk-panel-head"><h2 id="lk-party-agreements">Agreements</h2></div>
        <ul className="lk-list">{agreements.map(a => <li key={a.id}><span><a href={`#agreement/${a.id}`}>{a.title}</a> · {typeLabel[a.type]} · {statusLabel[a.status] ?? a.status} · {a.value_cents === null ? 'no value' : `${money(a.value_cents)} USD`} · risk {rolled(state.risk.agreements[a.id])}</span></li>)}</ul>
      </section>
    </div>
  )
}
