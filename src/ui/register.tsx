// Agreements as a board: one column per stage, each agreement a small page
// card with its counterparty, value, version, owner and next notice deadline.
// The command bar's search runs on the server across titles, counterparties
// and the version text you can access; the chips narrow the board to a stage.
import { useEffect, useMemo, useState } from 'react'
import { fetchJson, type LocketState, type Row } from './api'
import { Avatar, Badge, EmptyState, Icon } from './controls'
import { can, currentVersion, money, partyName, personName, statusLabel } from './format'
import { blockers, nextNotice } from './summary'

const columns = [
  { id: 'draft', title: 'Draft', statuses: ['draft'] },
  { id: 'in_review', title: 'In review', statuses: ['in_review'] },
  { id: 'approved', title: 'Approved', statuses: ['approved'] },
  { id: 'out_for_signature', title: 'Out for signature', statuses: ['out_for_signature'] },
  { id: 'executed', title: 'Executed', statuses: ['executed', 'imported'] },
]

export function Register({ state, query }: { state: LocketState; query: string }) {
  const [status, setStatus] = useState('')
  const [hits, setHits] = useState<{ id: string; match: { version: number; excerpt: string } | null }[] | null>(null)
  const [searchError, setSearchError] = useState('')
  useEffect(() => {
    if (!query.trim()) { setHits(null); return }
    const timer = setTimeout(() => {
      fetchJson<{ results: any[] }>(`/api/locket/search?q=${encodeURIComponent(query)}`).then(r => { setHits(r.results); setSearchError('') }).catch(e => setSearchError(e.message))
    }, 250)
    return () => clearTimeout(timer)
  }, [query])
  const rows = useMemo(() => (hits ? state.agreements.filter(a => hits.some(h => h.id === a.id)) : state.agreements), [state.agreements, hits])
  const shown = columns.filter(c => !status || c.id === status)
  const count = (c: (typeof columns)[number]) => rows.filter(a => c.statuses.includes(a.status)).length
  return (
    <div className="lk-register">
      <div className="lk-titlebar">
        <div>
          <h1>Agreements</h1>
          <p className="lk-muted">{hits ? `${rows.length} of ${state.agreements.length} match “${query.trim()}”` : `${state.agreements.length} agreements you can access, by stage.`}</p>
        </div>
        {can(state, 'owner', 'counsel', 'approver', 'requester') && (
          <div className="lk-actions">
            <a className="lk-button lk-primary" href="#new">New request</a>
            <a className="lk-button" href="#import-signed">Import signed file</a>
          </div>
        )}
      </div>
      <div className="lk-filters" role="group" aria-label="Stage">
        {columns.map(c => (
          <button key={c.id} type="button" className={`lk-filter${status === c.id ? ' lk-selected' : ''}`} aria-pressed={status === c.id} onClick={() => setStatus(status === c.id ? '' : c.id)}>
            {c.title} <strong>{count(c)}</strong>
          </button>
        ))}
      </div>
      {searchError && <p className="lk-alert" role="alert">{searchError}</p>}
      {state.agreements.length === 0 ? (
        <section className="lk-panel"><EmptyState title="No agreements yet.">Start with New request, import a signed file, or move a DocuSign archive in under Imports.</EmptyState></section>
      ) : rows.length === 0 ? <p className="lk-empty">No agreement you can access matches.</p> : (
        <div className="lk-board" style={{ '--lk-columns': shown.length } as React.CSSProperties}>
          {shown.map(c => {
            const list = rows.filter(a => c.statuses.includes(a.status))
            return (
              <section key={c.id} className="lk-column" aria-label={c.title}>
                <h2>{c.title} <span className="lk-count">{list.length}</span></h2>
                {list.length === 0 ? <p className="lk-column-empty">Nothing here.</p> : list.map(a => <AgreementCard key={a.id} state={state} a={a} hit={hits?.find(h => h.id === a.id)?.match ?? null} />)}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AgreementCard({ state, a, hit }: { state: LocketState; a: Row; hit: { version: number; excerpt: string } | null }) {
  const v = currentVersion(state, a), notice = nextNotice(state, a), blocked = blockers(state, a).length
  const owner = personName(state, a.owner_id)
  return (
    <article className="lk-board-card">
      <h3><a href={`#agreement/${a.id}`}>{a.title}</a></h3>
      <p className="lk-board-party">{partyName(state, a.party_id)}</p>
      <p className="lk-board-facts">
        <span>{money(a.value_cents)}</span>
        {v && <span className="lk-version-tag">v{v.number}</span>}
        {a.status === 'imported' && <Badge value="imported" label={statusLabel.imported} />}
      </p>
      {hit && <p className="lk-excerpt">v{hit.version}: …{hit.excerpt}…</p>}
      {notice && <p className="lk-board-notice"><Icon name="calendar" /><span>Notice by {notice.text.split(',').slice(0, 2).join(',')}</span></p>}
      {blocked > 0 && <p className="lk-board-blocked"><Icon name="warn" /><span>{blocked} open {blocked === 1 ? 'item' : 'items'}</span></p>}
      <p className="lk-board-foot"><Avatar name={owner} /><span>{owner}</span><small>{a.reference}{a.restricted ? ' · restricted' : ''}</small></p>
    </article>
  )
}
