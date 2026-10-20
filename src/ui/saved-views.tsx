import { useEffect, useState, type CSSProperties } from 'react'
import { repositoryFields } from '../locket/repository-fields'
import { fetchJson, type LocketState } from './api'
import type { Locket } from './app'
import type { SearchPassage } from '../locket/search-passages'
import { PassageLinks } from './search-passages'
import { Field } from './controls'

type ViewDefinition = {
  query: string
  filters: { field: string; operator: 'eq' | 'contains' | 'gte' | 'lte'; value: string }[]
  sort: { field: string; direction: 'asc' | 'desc' }
  columns: string[]
}
type SavedView = { id: string; name: string; definition: ViewDefinition; shared_roles: string[]; version: number; created_by: string; pinned: boolean }
type Results = {
  definition: ViewDefinition
  columns: { id: string; label: string; kind: string }[]
  rows: { id: string; matches: SearchPassage[]; values: Record<string, string | number | null> }[]
  evaluatedAt: number | string
  name?: string
}
const roles = ['owner', 'counsel', 'approver', 'requester', 'viewer', 'agent']
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12, minWidth: 0 }
const wrap: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const blank = (query: string): ViewDefinition => ({ query, filters: [], sort: { field: 'title', direction: 'asc' }, columns: ['title', 'value', 'owner', 'notice_deadline'] })
const endpoint = (request: string) => `/api/locket/repository?${request}`
const definitionRequest = (definition: ViewDefinition) => `definition=${encodeURIComponent(JSON.stringify(definition))}`

export function SavedViews({ state, locket, query, onActive }: { state: LocketState; locket: Locket; query: string; onActive: (active: boolean) => void }) {
  const views = state.savedViews as SavedView[]
  const [selectedId, setSelectedId] = useState('')
  const [name, setName] = useState('')
  const [definition, setDefinition] = useState<ViewDefinition>(() => blank(query))
  const [sharedRoles, setSharedRoles] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const [request, setRequest] = useState('')
  const [results, setResults] = useState<Results | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [revision, setRevision] = useState(0)
  const selected = views.find(view => view.id === selectedId)
  const human = state.actor.role !== 'agent'
  const owns = human && selected?.created_by === state.actor.id
  const disabled = locket.busy

  useEffect(() => { onActive(!!request) }, [request, onActive])
  // State refreshes also re-evaluate an open view against current agreement access.
  useEffect(() => {
    if (!request) { setResults(null); setLoading(false); return }
    let current = true
    setLoading(true); setError(''); setResults(null)
    fetchJson<Results>(endpoint(request)).then(result => {
      if (current) setResults(result)
    }).catch(cause => { if (current) setError((cause as Error).message) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [request, state, revision])

  function choose(id: string) {
    setSelectedId(id); setError('')
    const view = views.find(item => item.id === id)
    setName(view?.name ?? ''); setDefinition(view ? structuredClone(view.definition) : blank(query)); setSharedRoles(view ? [...view.shared_roles] : [])
  }
  function preview() {
    if (!definition.columns.length) { setError('Choose at least one result column.'); return }
    setError(''); setRequest(definitionRequest(definition)); setRevision(value => value + 1)
  }
  async function save(asNew: boolean) {
    if (!name.trim()) { setError('Enter a view name before saving.'); return }
    if (!definition.columns.length) { setError('Choose at least one result column.'); return }
    setError('')
    try {
      const result = await locket.run('view.save', { ...(!asNew && selected ? { id: selected.id, version: selected.version } : {}), name: name.trim(), definition, sharedRoles })
      if (result) {
        setSelectedId(result.id); setRequest(`viewId=${encodeURIComponent(result.id)}`)
      }
    } catch (cause) { setError((cause as Error).message) }
  }
  async function command(type: string, payload: object) {
    setError('')
    try { return await locket.run(type, payload) } catch (cause) { setError((cause as Error).message); return null }
  }
  async function exportCsv() {
    if (!request) return
    setExporting(true); setError('')
    try {
      const response = await fetch(`${endpoint(request)}&format=csv`, { credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok) {
        const body: any = await response.json().catch(() => null)
        throw new Error(body?.error?.message ?? 'CSV export failed. Try again.')
      }
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url; link.download = 'repository-view.csv'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) { setError((cause as Error).message) } finally { setExporting(false) }
  }

  return <section className="lk-panel" role="region" aria-label="Saved repository views" style={{ minWidth: 0, maxWidth: '100%', marginBottom: 18 }}>
    <h2 id="saved-views-title">Saved repository views</h2>
    <div style={grid}>
      <Field label="Saved view"><select value={selectedId} onChange={event => choose(event.target.value)} style={{ width: '100%', minWidth: 0 }}>
        <option value="">Choose a saved view</option>
        {[true, false].map(pinned => <optgroup key={String(pinned)} label={pinned ? 'Pinned by you' : 'Other saved views'}>
          {views.filter(view => view.pinned === pinned).map(view => <option key={view.id} value={view.id}>{view.name}</option>)}
        </optgroup>)}
      </select></Field>
      <div className="lk-actions" style={wrap}>
        <button type="button" disabled={!selected} onClick={() => { setError(''); setRequest(`viewId=${encodeURIComponent(selectedId)}`); setRevision(value => value + 1) }}>Open saved view</button>
        <button type="button" disabled={!selected} onClick={() => setEditing(true)}>View definition</button>
        <button type="button" onClick={() => { choose(''); setEditing(true) }}>New view</button>
        {selected && human && <button type="button" disabled={disabled} onClick={() => void command('view.pin', { viewId: selected.id, pinned: !selected.pinned })}>{selected.pinned ? 'Unpin view' : 'Pin view'}</button>}
      </div>
    </div>
    {!views.length && <p className="lk-muted">No saved views are available. Create a view from your current search.</p>}
    <details className="lk-disclosure" open={editing} onToggle={event => setEditing(event.currentTarget.open)}>
      <summary>View settings</summary>
      <form className="lk-form" onSubmit={event => { event.preventDefault(); preview() }}>
        <fieldset disabled={disabled} style={{ border: 0, padding: 0, minWidth: 0 }}>
          <div style={grid}>
            <Field label="View name"><input value={name} onChange={event => setName(event.target.value)} maxLength={160} /></Field>
            <Field label="View query" hint="Search standard metadata and all accessible version text."><input type="search" value={definition.query} onChange={event => setDefinition({ ...definition, query: event.target.value })} /></Field>
          </div>
          <FilterEditor definition={definition} onChange={setDefinition} />
          <div style={grid}>
            <Field label="Sort field"><select value={definition.sort.field} onChange={event => setDefinition({ ...definition, sort: { ...definition.sort, field: event.target.value } })}>{repositoryFields.map(field => <option key={field.id} value={field.id}>{field.label}</option>)}</select></Field>
            <Field label="Sort direction"><select value={definition.sort.direction} onChange={event => setDefinition({ ...definition, sort: { ...definition.sort, direction: event.target.value as 'asc' | 'desc' } })}><option value="asc">Ascending</option><option value="desc">Descending</option></select></Field>
          </div>
          <ColumnEditor definition={definition} onChange={setDefinition} />
          <fieldset className="lk-fieldset" style={{ minWidth: 0 }}>
            <legend>Share view definition</legend>
            <label><input type="checkbox" checked={!sharedRoles.length} onChange={() => setSharedRoles([])} /> Private to me</label>
            <div style={wrap}>{roles.map(role => <label key={role} className="lk-check"><input aria-label={`Shared with ${role}`} type="checkbox" checked={sharedRoles.includes(role)} onChange={event => setSharedRoles(event.target.checked ? [...sharedRoles, role] : sharedRoles.filter(item => item !== role))} /> {role[0].toUpperCase() + role.slice(1)}</label>)}</div>
            <p className="lk-muted">Sharing a view never grants access to agreements. Pins are personal.</p>
          </fieldset>
          <div className="lk-form-actions" style={wrap}>
            <button type="submit">Apply view</button>
            {human && <button type="button" className="lk-primary" disabled={!name.trim() || !definition.columns.length} onClick={() => void save(true)}>{selected ? 'Save as new view' : 'Save view'}</button>}
            {owns && selected && <button type="button" disabled={!name.trim() || !definition.columns.length} onClick={() => void save(false)}>Save changes</button>}
            {owns && selected && <button type="button" onClick={async () => {
              if (await command('view.delete', { id: selected.id, version: selected.version })) { choose(''); setRequest('') }
            }}>Delete view</button>}
          </div>
          {selected && !owns && <p className="lk-muted">Only the creator can update or delete this saved view.{human ? ' Save a copy to keep your changes.' : ''}</p>}
        </fieldset>
      </form>
    </details>
    {error && <p className="lk-alert" role="alert">{error}</p>}
    {request && <div style={{ minWidth: 0 }}>
      <div className="lk-actions" style={wrap}>
        <button type="button" onClick={() => setRequest('')}>Return to board</button>
        <button type="button" disabled={loading || exporting || !results} onClick={() => void exportCsv()}>{exporting ? 'Exporting CSV…' : 'Export view CSV'}</button>
      </div>
      {loading && <p role="status">Loading repository view…</p>}
      {results && <RepositoryResults results={results} />}
    </div>}
  </section>
}

function FilterEditor({ definition, onChange }: { definition: ViewDefinition; onChange: (definition: ViewDefinition) => void }) {
  function update(index: number, change: Partial<ViewDefinition['filters'][number]>) {
    onChange({ ...definition, filters: definition.filters.map((filter, at) => at === index ? { ...filter, ...change } : filter) })
  }
  return <fieldset className="lk-fieldset" style={{ minWidth: 0 }}>
    <legend>Filters (all must match)</legend>
    {definition.filters.map((filter, index) => {
      const field = repositoryFields.find(item => item.id === filter.field)
      return <div key={index} style={{ ...grid, marginBottom: 12 }}>
        <Field label={`Filter field ${index + 1}`}><select value={filter.field} onChange={event => update(index, { field: event.target.value })}>{repositoryFields.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
        <Field label={`Filter operator ${index + 1}`}><select value={filter.operator} onChange={event => update(index, { operator: event.target.value as typeof filter.operator })}><option value="eq">Equals</option><option value="contains">Contains</option><option value="gte">At least / on or after</option><option value="lte">At most / on or before</option></select></Field>
        <Field label={`Filter value ${index + 1}`} hint={field?.kind === 'money' ? 'Amount in USD, for example 1000.25.' : undefined}><input type={field?.kind === 'date' ? 'date' : field?.kind === 'number' || field?.kind === 'money' ? 'number' : 'text'} step="any" value={filter.value} required onChange={event => update(index, { value: event.target.value })} /></Field>
        <button type="button" aria-label={`Remove filter ${index + 1}`} onClick={() => onChange({ ...definition, filters: definition.filters.filter((_, at) => at !== index) })}>Remove filter</button>
      </div>
    })}
    <button type="button" onClick={() => onChange({ ...definition, filters: [...definition.filters, { field: 'status', operator: 'eq', value: '' }] })}>Add filter</button>
  </fieldset>
}

function ColumnEditor({ definition, onChange }: { definition: ViewDefinition; onChange: (definition: ViewDefinition) => void }) {
  function move(index: number, delta: number) {
    const columns = [...definition.columns]
    ;[columns[index], columns[index + delta]] = [columns[index + delta], columns[index]]
    onChange({ ...definition, columns })
  }
  return <fieldset className="lk-fieldset" style={{ minWidth: 0 }}>
    <legend>Result columns</legend>
    <div style={grid}>{repositoryFields.map(field => <label key={field.id} className="lk-check"><input aria-label={`Column ${field.label}`} type="checkbox" checked={definition.columns.includes(field.id)} onChange={event => onChange({ ...definition, columns: event.target.checked ? [...definition.columns, field.id] : definition.columns.filter(id => id !== field.id) })} /> {field.label}</label>)}</div>
    <ol aria-label="Result column order" style={{ paddingLeft: 24 }}>
      {definition.columns.map((id, index) => {
        const label = repositoryFields.find(field => field.id === id)?.label ?? id
        return <li key={id}><div style={wrap}><span>{label}</span><button type="button" disabled={index === 0} aria-label={`Move ${label} up`} onClick={() => move(index, -1)}>Move up</button><button type="button" disabled={index === definition.columns.length - 1} aria-label={`Move ${label} down`} onClick={() => move(index, 1)}>Move down</button></div></li>
      })}
    </ol>
  </fieldset>
}

function RepositoryResults({ results }: { results: Results }) {
  const cell: CSSProperties = { overflowWrap: 'anywhere', whiteSpace: 'normal', padding: 8, verticalAlign: 'top' }
  return <div aria-label="Repository view results">
    <h3>{results.name ?? 'View preview'}</h3>
    <p role="status">{results.rows.length} {results.rows.length === 1 ? 'agreement' : 'agreements'} you can access.</p>
    {!results.rows.length ? <p className="lk-empty">No accessible agreements match this view.</p> : <><p className="lk-muted">Results in the selected column order</p><table aria-label="Saved view results" className="lk-table" style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
      <thead><tr>{results.columns.map(column => <th scope="col" key={column.id} style={cell}>{column.label}</th>)}</tr></thead>
      <tbody>{results.rows.map(row => <tr key={row.id}>{results.columns.map(column => {
        const value = row.values[column.id]
        const display = value == null ? '—' : column.kind === 'money' ? usd.format(Number(value) / 100) : String(value)
        return <td key={column.id} data-label={column.label} style={cell}>{column.id === 'title' ? <a href={`#agreement/${row.id}`}>{display}</a> : display}</td>
      })}</tr>)}</tbody>
    </table>{results.rows.filter(row => row.matches.length).map(row => <section key={row.id}><h4>{String(row.values.title ?? row.id)}</h4><PassageLinks agreementId={row.id} matches={row.matches} /></section>)}</>}
  </div>
}
