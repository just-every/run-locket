import { useEffect, useMemo, useState } from 'react'
import { fetchJson, type LocketState, type Row } from './api'
import { Badge, Empty, EmptyState, Icon, Person } from './controls'
import { Engraved } from './engraved'
import { can, currentVersion, day, money, partyName, personName, statusLabel, typeLabel, versionsOf, when } from './format'
import { blockers, liveApprovals, nextNotice, staleApproval, timeline } from './summary'

const filters = ['draft', 'in_review', 'approved', 'out_for_signature', 'executed', 'imported']

export function Register({ state }: { state: LocketState }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [hits, setHits] = useState<{ id: string; match: { version: number; excerpt: string } | null }[] | null>(null)
  const [searchError, setSearchError] = useState('')
  const [selected, setSelected] = useState<string>('')
  // Search runs on the server, across titles, counterparties and version text you can access.
  useEffect(() => {
    if (!query.trim()) { setHits(null); return }
    const timer = setTimeout(() => {
      fetchJson<{ results: any[] }>(`/api/locket/search?q=${encodeURIComponent(query)}`).then(r => { setHits(r.results); setSearchError('') }).catch(e => setSearchError(e.message))
    }, 250)
    return () => clearTimeout(timer)
  }, [query])
  const rows = useMemo(() => {
    let list = state.agreements
    if (hits) list = list.filter(a => hits.some(h => h.id === a.id))
    if (status) list = list.filter(a => a.status === status)
    return list
  }, [state.agreements, hits, status])
  const chosen = rows.find(a => a.id === selected) ?? rows[0] ?? null
  const counts = Object.fromEntries(filters.map(f => [f, state.agreements.filter(a => a.status === f).length]))
  return (
    <div className="lk-register">
      <div className="lk-titlebar">
        <h1>Agreements</h1>
        {can(state, 'owner', 'counsel', 'approver', 'requester') && (
          <div className="lk-actions">
            <a className="lk-button lk-primary lk-large-action" href="#new">New request</a>
            <a className="lk-button lk-large-action" href="#import-signed">Import signed file</a>
          </div>
        )}
      </div>
      <label className="lk-search"><Icon name="search" /><span className="lk-visually-hidden">Search agreements you can access</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search agreements you can access" /></label>
      <div className="lk-filters">
        {filters.map(f => (
          <button key={f} type="button" className={`lk-filter${status === f ? ' lk-selected' : ''}`} aria-pressed={status === f} onClick={() => setStatus(status === f ? '' : f)}>
            {statusLabel[f]} <strong>{counts[f]}</strong>
          </button>
        ))}
      </div>
      {searchError && <p className="lk-alert" role="alert">{searchError}</p>}
      <div className={chosen ? 'lk-split' : undefined}>
        <section className="lk-panel lk-table-panel" aria-label="Agreement register">
          {rows.length === 0 ? (
            state.agreements.length ? <Empty>No agreement you can access matches.</Empty> : <EmptyState title="No agreements yet.">Start with New request, import a signed file, or move a DocuSign archive in under Imports.</EmptyState>
          ) : (
            <div className="lk-table-wrap">
              <table className="lk-table lk-register-table">
                <thead><tr><th>Agreement</th><th>Counterparty</th><th>Type</th><th>Owner</th><th>Status</th><th>Current version</th><th>Value (AUD)</th><th>Next notice deadline</th></tr></thead>
                <tbody>
                  {rows.map(a => {
                    const v = currentVersion(state, a), notice = nextNotice(state, a), hit = hits?.find(h => h.id === a.id)
                    return (
                      <tr key={a.id} className={chosen?.id === a.id ? 'lk-selected' : undefined} onClick={() => setSelected(a.id)}>
                        <td data-label="Agreement"><span className="lk-record-head"><a href={`#agreement/${a.id}`} onClick={e => e.stopPropagation()}>{a.title}</a><span className="lk-record-status"><Badge value={a.status} /></span></span><small>{a.reference}{a.restricted ? ' · restricted' : ''}</small>{hit?.match && <small className="lk-excerpt">v{hit.match.version}: …{hit.match.excerpt}…</small>}</td>
                        <td data-label="Counterparty">{partyName(state, a.party_id)}</td>
                        <td data-label="Type">{typeLabel[a.type]}</td>
                        <td data-label="Owner"><Person name={personName(state, a.owner_id)} /></td>
                        <td data-label="Status"><Badge value={a.status} /></td>
                        <td data-label="Current version">{v ? <span className="lk-version-tag">v{v.number}</span> : '—'}</td>
                        <td data-label="Value (AUD)">{money(a.value_cents)}</td>
                        <td data-label="Next notice deadline">{notice ? <>{notice.text.split(',')[0]}<small>{notice.text.split(',')[1]}</small></> : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="lk-table-foot">Showing {rows.length} of {state.agreements.length} agreements</p>
        </section>
        {chosen && <Summary state={state} a={chosen} />}
      </div>
    </div>
  )
}

function Summary({ state, a }: { state: LocketState; a: Row }) {
  const versions = versionsOf(state, a.id), v = currentVersion(state, a)
  const live = liveApprovals(state, a), stale = staleApproval(state, a)
  const approvedVersion = state.approvals.filter(x => x.agreement_id === a.id && x.decision === 'approved').map(x => x.version_id)
  const blocked = blockers(state, a), notice = nextNotice(state, a)
  return (
    <aside className="lk-panel lk-side" aria-label="Selected agreement">
      <div className="lk-side-head">
        <h2><a href={`#agreement/${a.id}`}>{a.title}</a></h2>
        <Badge value={a.status} />
      </div>
      <p className="lk-meta">{partyName(state, a.party_id)} · {typeLabel[a.type]}{v ? ` · v${v.number}` : ''}</p>
      <h3>Status timeline</h3>
      <ol className="lk-timeline">
        {timeline(state, a).map(step => (
          <li key={step.label} className={step.done ? 'lk-done' : undefined}>
            <span className="lk-dot" aria-hidden="true">{step.done && <Icon name="check" />}</span>
            <span>{step.label}</span>
            <small>{step.done ? step.on : '—'}</small>
          </li>
        ))}
      </ol>
      <h3>Version history</h3>
      {versions.length ? (
        <ul className="lk-version-list">
          {versions.map(x => (
            <li key={x.id} className={x.id === v?.id ? 'lk-current' : undefined}>
              <span>v{x.number}</span>
              <span>{x.id === v?.id ? (live.some(l => l.decision === 'approved' && l.kind === 'commercial') ? 'Current · approved' : 'Current') : approvedVersion.includes(x.id) ? 'Earlier · approved' : 'Earlier'}</span>
              <time>{when(x.created_at)}</time>
            </li>
          ))}
        </ul>
      ) : <Empty>No document version yet.</Empty>}
      {stale && <p className="lk-warning"><Icon name="warn" /> Approval no longer matches the current version{stale.invalidated_reason ? `: ${stale.invalidated_reason}` : ''}.</p>}
      {blocked.length > 0 && (
        <>
          <h3>Blocked items</h3>
          <ul className="lk-blocked">{blocked.map(b => <li key={b.title}><Icon name="ban" /><span>{b.title}<small>{b.detail}</small></span></li>)}</ul>
        </>
      )}
      {notice && (
        <a className="lk-notice-card" href="#renewals" aria-label={`Next notice ${notice.text}, ${notice.zone}. Open renewals`}>
          <Engraved medallion="calendar">
            <span>Next notice</span>
            <strong className="lk-big-date">{notice.text.split(', ').map((part, i, all) => <span key={part}>{part}{i < all.length - 1 ? ',' : ''}{' '}</span>)}</strong>
            <span className="lk-serif">{notice.zone}{notice.renewal.decision ? ` · decided: ${notice.renewal.decision}` : ' · decision open'}</span>
          </Engraved>
        </a>
      )}
      <div className="lk-side-foot">
        <div><h4>Counterparty</h4><p>{partyName(state, a.party_id)}</p></div>
        <div><h4>Owner</h4><p><Person name={personName(state, a.owner_id)} /></p></div>
      </div>
    </aside>
  )
}
