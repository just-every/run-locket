import { useEffect, useState } from 'react'
import { fetchJson, type LocketState } from './api'
import { Avatar, Badge, Empty, Field, Form, Icon } from './controls'
import { actionLabel, can, clock, dayOf, roleLabel, words } from './format'

type AuditRow = LocketState['audit'][number]
type Filters = { person: string; agreement: string; action: string; from: string; to: string; q: string }
const emptyFilters: Filters = { person: '', agreement: '', action: '', from: '', to: '', q: '' }
const PAGE = 20
const action = (key: string) => actionLabel[key] ?? words(key.replace('.', ' '))

function auditUrl(filters: Filters, csv = false) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value.trim()) params.set(key, value.trim())
  if (csv) params.set('format', 'csv')
  const query = params.toString()
  return `/api/locket/audit${query ? `?${query}` : ''}`
}

export function AuditLog({ state }: { state: LocketState }) {
  return can(state, 'owner', 'counsel')
    ? <FilteredAudit key={`${state.actor.id}:${state.actor.role}`} state={state} />
    : <VisibleActivity state={state} />
}

function FilteredAudit({ state }: { state: LocketState }) {
  const [draft, setDraft] = useState(emptyFilters)
  const [applied, setApplied] = useState(emptyFilters)
  const [rows, setRows] = useState<AuditRow[]>(state.audit)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    fetchJson<{ rows: AuditRow[] }>(auditUrl(applied)).then(result => {
      if (active) setRows(result.rows)
    }).catch(cause => {
      if (active) setError((cause as Error).message)
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [applied])
  const update = (field: keyof Filters, value: string) => setDraft(current => ({ ...current, [field]: value }))
  const people = new Map(state.operators.map(person => [person.id, person.name as string]))
  for (const row of [...state.audit, ...rows]) if (row.actor_id && !people.has(row.actor_id)) people.set(row.actor_id, row.actor_name)
  const actions = [...new Set([...Object.keys(actionLabel), ...state.audit.map(row => row.action as string), ...rows.map(row => row.action as string)])].sort()
  return (
    <section className="lk-panel lk-activity-log" aria-busy={loading}>
      <div className="lk-panel-head"><h2>Activity log</h2>{!loading && !error && <a className="lk-button" href={auditUrl(applied, true)} download><Icon name="export" />Export audit CSV</a>}</div>
      <Form busy={loading} submit="Apply filters" onSubmit={() => {
        if (loading) return
        setLoading(true)
        setApplied({ ...draft })
      }}>
        <div className="lk-grid2">
          <Field label="Person"><select name="person" value={draft.person} onChange={event => update('person', event.target.value)}><option value="">All people</option>{[...people].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>
          <Field label="Agreement"><select name="agreement" value={draft.agreement} onChange={event => update('agreement', event.target.value)}><option value="">All agreements</option>{state.agreements.map(agreement => <option key={agreement.id} value={agreement.id}>{agreement.reference} · {agreement.title}</option>)}</select></Field>
          <Field label="Action"><select name="action" value={draft.action} onChange={event => update('action', event.target.value)}><option value="">All actions</option>{actions.map(key => <option key={key} value={key}>{action(key)}</option>)}</select></Field>
          <Field label="Search activity"><input type="search" name="q" value={draft.q} onChange={event => update('q', event.target.value)} placeholder="Search activity" /></Field>
          <Field label="From (UTC)" hint="Includes the entire start date in UTC."><input type="date" name="from" value={draft.from} max={draft.to || undefined} onChange={event => update('from', event.target.value)} /></Field>
          <Field label="To (UTC)" hint="Includes the entire end date in UTC."><input type="date" name="to" value={draft.to} min={draft.from || undefined} onChange={event => update('to', event.target.value)} /></Field>
        </div>
      </Form>
      {loading && <p className="lk-muted" role="status">Loading activity…</p>}
      {error ? <p className="lk-alert" role="alert">Could not load activity. {error}</p> : <AuditTimeline state={state} rows={rows} filtered={Object.values(applied).some(value => value.trim())} />}
    </section>
  )
}

function VisibleActivity({ state }: { state: LocketState }) {
  const [query, setQuery] = useState('')
  const rows = state.audit.filter(row => !query || `${row.actor_name} ${row.action} ${action(row.action)} ${row.summary}`.toLowerCase().includes(query.toLowerCase()))
  return (
    <section className="lk-panel lk-activity-log">
      <div className="lk-panel-head"><h2>Activity log</h2><label className="lk-search lk-search-small"><Icon name="search" /><span className="lk-visually-hidden">Search activity</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search activity" /></label></div>
      <AuditTimeline key={query} state={state} rows={rows} filtered={!!query} />
    </section>
  )
}

function AuditTimeline({ state, rows, filtered }: { state: LocketState; rows: AuditRow[]; filtered: boolean }) {
  const [shown, setShown] = useState(PAGE)
  useEffect(() => setShown(PAGE), [rows])
  const days: { day: string; rows: AuditRow[] }[] = []
  for (const row of rows.slice(0, shown)) {
    const day = dayOf(row.at)
    if (days.at(-1)?.day !== day) days.push({ day, rows: [] })
    days.at(-1)!.rows.push(row)
  }
  if (!rows.length) return <Empty>{filtered ? 'No activity matches these filters.' : 'No activity yet.'}</Empty>
  return (
    <>
      {days.map(day => (
        <div key={day.day} className="lk-log-day">
          <h3>{day.day}</h3>
          <ol className="lk-log-items">{day.rows.map(row => {
            const agreement = state.agreements.find(item => item.id === row.agreement_id)
            return (
              <li key={row.id} className="lk-log-item" data-audit-id={row.id}>
                <time>{clock(row.at)}</time>
                <Avatar name={row.actor_name} agent={row.actor_role === 'agent'} />
                <div>
                  <p><strong>{row.actor_name}</strong> <span className="lk-muted">{roleLabel[row.actor_role] ?? row.actor_role}</span> <Badge value={row.action} tone="good" label={action(row.action)} />{agreement && <> <a href={`#agreement/${agreement.id}`}>{agreement.reference}</a></>}</p>
                  <p className="lk-muted">{row.summary}</p>
                </div>
              </li>
            )
          })}</ol>
        </div>
      ))}
      {rows.length > shown && <p className="lk-table-foot">Showing the latest {shown} of {rows.length}. <button type="button" className="lk-small" onClick={() => setShown(current => current + PAGE)}>Show more</button></p>}
    </>
  )
}
