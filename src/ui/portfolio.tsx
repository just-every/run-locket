import type { LocketState } from './api'
import { WorkflowAnalytics } from './workflow-analytics'
import { day, deadline, money } from './format'
import type { PortfolioTile } from '../locket/portfolio'

function Tile({ tile, hidden }: { tile: PortfolioTile;hidden:boolean }) {
  return <a className="lk-panel lk-portfolio-tile" href={`#agreements/portfolio/${tile.id}`} data-portfolio-tile={tile.id}>
    <span>{tile.label}</span><strong>{tile.count} {tile.count === 1 ? 'agreement' : 'agreements'}</strong>
    <span>{hidden?'Value hidden':money(tile.valueCents)+' USD'}</span>
    {!hidden&&tile.unvalued > 0 && <small>{tile.unvalued} without a recorded value</small>}
    {tile.obligationCount !== undefined && <small>{tile.obligationCount} overdue obligations</small>}
  </a>
}
export function Portfolio({ state }: { state: LocketState }) {
  const { tiles, lifecycle } = state.portfolio
  const due = state.agreements.filter(a => lifecycle[a.id].deadline && lifecycle[a.id].deadline!.at >= state.now && lifecycle[a.id].deadline!.days <= 90).sort((a, b) => lifecycle[a.id].deadline!.at - lifecycle[b.id].deadline!.at)
  return <div className="lk-stack">
    <div className="lk-titlebar"><div><h1>Portfolio</h1><p className="lk-muted">Contracted values and current terms for agreements you can access.</p></div><a className="lk-button" href="#agreements">Open register</a></div>
    <p className="lk-muted">Values include executed and imported agreements, including expired ones. Windows include today through the named calendar day in each agreement’s time zone. Missing values are listed separately.</p>
    <div className="lk-portfolio-grid">{tiles.map(tile => <Tile key={tile.id} tile={tile} hidden={state.fieldAccess.hidden.includes('value')}/>)}</div>
    <section className="lk-panel"><h2>Notice deadlines · next 90 days</h2>
      {due.length === 0 ? <p className="lk-empty">No upcoming notice deadlines.</p> : <ul className="lk-list">{due.map(a => {
        const term = lifecycle[a.id], d = term.deadline!
        return <li key={a.id}><a href={`#agreement/${a.id}`}>{a.title}</a>{!state.fieldAccess.hidden.includes('value')&&<span>{money(a.value_cents)} USD</span>}<span>{d.days} days left · {deadline(d.at, a.timezone)}</span><small>Term {term.term}: {day(term.start)} – {day(term.end)}</small></li>
      })}</ul>}
    </section>
    <p className="lk-muted">Missing key terms means a required effective date, term length or end date, renewal type, notice period, governing law, payment term or renewal length is unconfirmed. Current terms follow confirmed values. Committed renewals keep their source history, and corrected derivations remain visible as superseded.</p>
    <WorkflowAnalytics state={state} />
  </div>
}
