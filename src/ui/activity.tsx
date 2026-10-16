import { useState } from 'react'
import { fetchJson, type LocketState } from './api'
import type { Locket } from './app'
import { Badge, Empty, Field, Form, Icon, Person, value } from './controls'
import { Engraved } from './engraved'
import { actionLabel, can, roleLabel, when, words } from './format'

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
  return (
    <div className="lk-activity">
      <div className="lk-titlebar"><div><h1>Activity</h1><p className="lk-muted">Every consequential change, who made it and in which role. Agents appear by name with the agent role.</p></div></div>
      <div className="lk-split">
        <section className="lk-panel lk-table-panel">
          <div className="lk-panel-head"><h2>Activity log</h2><label className="lk-search lk-search-small"><Icon name="search" /><span className="lk-visually-hidden">Search activity</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search activity" /></label></div>
          {audit.length === 0 ? <Empty>No activity yet.</Empty> : (
            <div className="lk-table-wrap">
              <table className="lk-table">
                <thead><tr><th>Date and time</th><th>Actor</th><th>Action</th><th>Agreement</th><th>Details</th></tr></thead>
                <tbody>{audit.slice(0, shown).map(x => {
                  const ag = reference(x.agreement_id)
                  return (
                    <tr key={x.id}>
                      <td data-label="Date and time" className="lk-serif lk-when">{when(x.at)}</td>
                      <td data-label="Actor"><span className="lk-serif"><Person name={x.actor_name} /></span><small>{roleLabel[x.actor_role] ?? x.actor_role}</small></td>
                      <td data-label="Action"><Badge value={x.action} tone="good" label={action(x.action)} /></td>
                      <td data-label="Agreement">{ag ? <a href={`#agreement/${ag.id}`}>{ag.reference}</a> : '—'}</td>
                      <td data-label="Details">{x.summary}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
              {audit.length > shown && <p className="lk-table-foot">Showing the latest {shown} of {audit.length}. <button type="button" className="lk-small" onClick={() => setShown(shown + PAGE)}>Show more</button></p>}
            </div>
          )}
        </section>
        <aside className="lk-panel lk-side">
          <div className="lk-side-head"><h2>People and access</h2></div>
          <ul className="lk-people">{state.operators.map(o => (
            <li key={o.id}>
              <Person name={o.name} />
              <small>{o.email ? <>{o.email.split('@')[0]}@<wbr />{o.email.split('@').slice(1).join('@')}</> : ''}{o.status !== 'active' ? ` · ${o.status}` : ''}</small>
              {owner && o.role !== 'owner' ? (
                <select aria-label={`Role for ${o.name}`} value={o.role} disabled={busy} onChange={e => void run('role.set', { operatorId: o.id, role: e.target.value })}>{assignable.map(r => <option key={r} value={r}>{roleLabel[r]}</option>)}</select>
              ) : <Badge value={o.role} tone={o.role === 'owner' ? 'good' : 'neutral'} label={roleLabel[o.role]} />}
            </li>
          ))}</ul>
          <p className="lk-muted">Owner: everything. Counsel: library, legal exceptions, restricted agreements. Approver: commercial approval, renewals and notices. Requester: requests, versions and signature handoff. Viewer: reads. Agent: prepares proposals only.</p>
          {owner && (
            <Form className="lk-invite" busy={busy || inviting} submit="Send invitation" onSubmit={invite}>
              <h3>Invite a person or agent</h3>
              <Field label="Email"><input type="email" name="email" placeholder="name@example.com" required /></Field>
              <Field label="Name"><input name="displayName" placeholder="Full name" required /></Field>
              <Field label="Role"><select name="role">{assignable.map(r => <option key={r} value={r}>{roleLabel[r]}</option>)}</select></Field>
            </Form>
          )}
          {owner && <Engraved className="lk-export"><a className="lk-button" href="/api/locket/export" download>Export complete archive (JSON with files)</a></Engraved>}
        </aside>
      </div>
    </div>
  )
}
