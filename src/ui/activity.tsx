import { useState } from 'react'
import { fetchJson, type LocketState } from './api'
import type { Locket } from './app'
import { AuditLog } from './audit'
import { ReminderSettings } from './approval-reminders'
import { Avatar, Badge, Field, Form, Icon, Person, value } from './controls'
import { can, roleLabel } from './format'

const assignable = ['counsel', 'approver', 'requester', 'viewer', 'agent']

export function Activity({ state, locket }: { state: LocketState; locket: Locket }) {
  const { run, busy, setError, setNotice } = locket
  const [inviting, setInviting] = useState(false)
  const owner = can(state, 'owner')
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
      <ReminderSettings state={state} locket={locket} />
      <AuditLog state={state} />
    </div>
  )
}
