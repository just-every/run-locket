import { useState } from 'react'
import { fetchJson, type LocketState } from './api'
import type { Locket } from './app'
import { Avatar, Badge, Empty, Field, Form, Icon, Person, value } from './controls'
import { actionLabel, can, dayOf, roleLabel, words } from './format'

const assignable = ['counsel', 'approver', 'requester', 'viewer', 'agent']
const PAGE = 20
const action = (key: string) => actionLabel[key] ?? words(key.replace('.', ' '))

export function Activity({ state, locket }: { state: LocketState; locket: Locket }) {
  const { run, busy, setError, setNotice } = locket
  const [query, setQuery] = useState('')
  const [inviting, setInviting] = useState(false)
  const [shown, setShown] = useState(PAGE)
  const owner = can(state, 'owner')
  const audit = state.audit.filter(x => !query || `${x.actor_name} ${x.action} ${action(x.action)} ${x.summary}`.toLowerCase().includes(query.toLowerCase()))
  const reference = (id: string | null) => (id ? state.agreements.find(a => a.id === id) : null)
  async function invite(data: FormData, form: HTMLFormElement) {
    const email = value(data, 'email'), role = value(data, 'role')
    setInviting(true)
    try {
      const response = await fetch('/auth/invite', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, displayName: value(data, 'displayName'), role: 'member', returnTo: '/app' }) })
      const body: any = await response.json().catch(() => ({}))
      if (response.status !== 202) return setError(`Invitation was not accepted (${body.error ?? response.status}).`)
      const fresh = await fetchJson<LocketState>('/api/locket/state')
      const invited = fresh.operators.find(o => o.email?.toLowerCase() === email.toLowerCase())
      if (invited && (await run('role.set', { operatorId: invited.id, role }))) {
        setNotice(`Invitation sent to ${email} as ${roleLabel[role]}.`)
        form.reset()
      }
    } finally {
      setInviting(false)
    }
  }
  const days: { day: string; rows: typeof audit }[] = []
  for (const x of audit.slice(0, shown)) {
    const label = dayOf(x.at)
    if (days.at(-1)?.day !== label) days.push({ day: label, rows: [] })
    days.at(-1)!.rows.push(x)
  }
  return (
    <div className="lk-activity">
      <div className="lk-titlebar"><div><h1>Activity</h1><p className="lk-muted">Every consequential change, who made it and in which role. Agents appear by name with the agent role.</p></div></div>
      <section className="lk-panel lk-people-panel">
        <div className="lk-panel-head"><h2>People and access</h2><span className="lk-muted">Owner: everything. Counsel: library, legal exceptions, restricted agreements. Approver: commercial approval, renewals and notices. Requester: requests, versions and signature handoff. Viewer: reads. Agent: prepares proposals only.</span></div>
        <ul className="lk-people">{state.operators.map(o => (
          <li key={o.id}>
            <Avatar name={o.name} agent={o.role === 'agent'} large />
            <span className="lk-person-name"><Person name={o.name} /><small>{o.email ? <>{o.email.split('@')[0]}@<wbr />{o.email.split('@').slice(1).join('@')}</> : ''}{o.status !== 'active' ? ` · ${o.status}` : ''}</small></span>
            {owner && o.role !== 'owner' ? (
              <select aria-label={`Role for ${o.name}`} value={o.role} disabled={busy} onChange={e => void run('role.set', { operatorId: o.id, role: e.target.value })}>{assignable.map(r => <option key={r} value={r}>{roleLabel[r]}</option>)}</select>
            ) : <Badge value={o.role} tone={o.role === 'owner' ? 'good' : 'neutral'} label={roleLabel[o.role]} />}
          </li>
        ))}</ul>
        {owner && (
          <div className="lk-people-tools">
            <Form className="lk-invite" busy={busy || inviting} submit="Send invitation" onSubmit={invite}>
              <h3>Invite a person or agent</h3>
              <Field label="Email"><input type="email" name="email" placeholder="name@example.com" required /></Field>
              <Field label="Name"><input name="displayName" placeholder="Full name" required /></Field>
              <Field label="Role"><select name="role">{assignable.map(r => <option key={r} value={r}>{roleLabel[r]}</option>)}</select></Field>
            </Form>
            <a className="lk-button lk-export" href="/api/locket/export" download><Icon name="export" />Export complete archive (JSON with files)</a>
          </div>
        )}
      </section>
      <section className="lk-panel lk-activity-log">
        <div className="lk-panel-head"><h2>Activity log</h2><label className="lk-search lk-search-small"><Icon name="search" /><span className="lk-visually-hidden">Search activity</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search activity" /></label></div>
        {audit.length === 0 ? <Empty>No activity yet.</Empty> : (
          <>
            {days.map(d => (
              <div key={d.day} className="lk-log-day">
                <h3>{d.day}</h3>
                <ol className="lk-log-items">{d.rows.map(x => {
                  const ag = reference(x.agreement_id)
                  return (
                    <li key={x.id} className="lk-log-item">
                      <time>{new Date(x.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</time>
                      <Avatar name={x.actor_name} agent={x.actor_role === 'agent'} />
                      <div>
                        <p><strong>{x.actor_name}</strong> <span className="lk-muted">{roleLabel[x.actor_role] ?? x.actor_role}</span> <Badge value={x.action} tone="good" label={action(x.action)} />{ag && <> <a href={`#agreement/${ag.id}`}>{ag.reference}</a></>}</p>
                        <p className="lk-muted">{x.summary}</p>
                      </div>
                    </li>
                  )
                })}</ol>
              </div>
            ))}
            {audit.length > shown && <p className="lk-table-foot">Showing the latest {shown} of {audit.length}. <button type="button" className="lk-small" onClick={() => setShown(shown + PAGE)}>Show more</button></p>}
          </>
        )}
      </section>
    </div>
  )
}
