import type { LocketState } from './api'
import type { Locket } from './app'
import { Badge, Empty, Field, Form, Icon, Person, value } from './controls'
import { Engraved } from './engraved'
import { can, currentVersion, day, money, partyName, personName, roleLabel, typeLabel, when } from './format'
import { Approvals, Review } from './review'
import { Execution, Signature } from './signature'
import { Terms } from './terms'
import { Versions } from './versions'

const tabs = [
  { id: 'versions', title: 'Versions' },
  { id: 'review', title: 'Review' },
  { id: 'approvals', title: 'Approvals' },
  { id: 'signature', title: 'Signature' },
  { id: 'execution', title: 'Execution' },
  { id: 'terms', title: 'Terms and obligations' },
  { id: 'details', title: 'Details and access' },
]

export function AgreementPage({ state, id, tab, locket }: { state: LocketState; id: string; tab: string; locket: Locket }) {
  const a = state.agreements.find(x => x.id === id)
  if (!a) return <Empty>No agreement you can access has this link. <a href="#agreements">Back to agreements</a></Empty>
  const v = currentVersion(state, a)
  const current = tabs.some(t => t.id === tab) ? tab : 'versions'
  const parent = a.parent_id ? state.agreements.find(x => x.id === a.parent_id) : null
  return (
    <div className="lk-agreement">
      <a className="lk-back" href="#agreements"><Icon name="back" />Back to agreements</a>
      <div className="lk-heading">
        <div>
          <h1>{a.title}</h1>
          <p className="lk-subtitle"><strong>{partyName(state, a.party_id)}</strong> <Badge value={a.status} />{v && <span className="lk-version-tag">v{v.number}</span>}<span className="lk-muted">{typeLabel[a.type]} · {a.reference}{a.restricted ? ' · restricted' : ''}</span></p>
          {parent && <p className="lk-muted">{a.relation?.replace('_', ' ')} <a href={`#agreement/${parent.id}`}>{parent.reference} {parent.title}</a></p>}
        </div>
        <Engraved className="lk-facts-card" medallion="document">
          <dl className="lk-facts">
            <div><dt>Owner</dt><dd><Person name={personName(state, a.owner_id)} /></dd></div>
            <div><dt>Value (USD)</dt><dd>{money(a.value_cents)}</dd></div>
            <div><dt>Needed by</dt><dd>{day(a.needed_by)}</dd></div>
            <div><dt>Start date</dt><dd>{day(a.start_date)}</dd></div>
          </dl>
        </Engraved>
      </div>
      <nav className="lk-tabs" aria-label="Agreement sections">
        {tabs.map(t => <a key={t.id} href={`#agreement/${a.id}/${t.id}`} className={t.id === current ? 'lk-selected' : undefined} aria-current={t.id === current ? 'page' : undefined}>{t.title}</a>)}
      </nav>
      {current === 'versions' && <Versions state={state} a={a} locket={locket} />}
      {current === 'review' && <Review state={state} a={a} locket={locket} />}
      {current === 'approvals' && <Approvals state={state} a={a} locket={locket} />}
      {current === 'signature' && <Signature state={state} a={a} locket={locket} />}
      {current === 'execution' && <Execution state={state} a={a} locket={locket} />}
      {current === 'terms' && <Terms state={state} a={a} locket={locket} />}
      {current === 'details' && <Details state={state} a={a} locket={locket} />}
    </div>
  )
}

function Details({ state, a, locket }: { state: LocketState; a: any; locket: Locket }) {
  const { run, busy } = locket
  const grants = state.access.filter(x => x.agreement_id === a.id)
  const people = state.operators.filter(o => o.status === 'active')
  const audit = state.audit.filter(x => x.agreement_id === a.id)
  const editable = can(state, 'owner', 'counsel', 'approver', 'requester') && ['draft', 'in_review', 'approved'].includes(a.status)
  return (
    <div className="lk-columns">
      <section className="lk-panel">
        <div className="lk-panel-head"><h2>Request details</h2></div>
        {editable ? (
          <Form busy={busy} submit="Save details" onSubmit={data => void run('request.update', { agreementId: a.id, version: a.version, title: value(data, 'title'), value: value(data, 'value'), ownerId: value(data, 'ownerId'), neededBy: value(data, 'neededBy'), restricted: data.get('restricted') === 'on' })}>
            <Field label="Title"><input name="title" defaultValue={a.title} required /></Field>
            <Field label="Value (USD)" hint="Changing the value withdraws earlier approvals."><input name="value" inputMode="decimal" defaultValue={a.value_cents === null ? '' : String(a.value_cents / 100)} /></Field>
            <Field label="Responsible person"><select name="ownerId" defaultValue={a.owner_id}>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Needed by"><input name="neededBy" type="date" defaultValue={a.needed_by ?? ''} /></Field>
            <label className="lk-check"><input type="checkbox" name="restricted" defaultChecked={!!a.restricted} /> Restricted: only owner, counsel, requester, responsible person and people granted access can see it</label>
          </Form>
        ) : <p className="lk-muted">Request details are fixed once an agreement is out for signature or executed.</p>}
      </section>
      <section className="lk-panel">
        <div className="lk-panel-head"><h2>Access</h2></div>
        {a.restricted ? (
          <>
            <ul className="lk-list">{grants.length ? grants.map(g => <li key={g.operator_id}><Person name={personName(state, g.operator_id)} />{can(state, 'owner', 'counsel') && <button type="button" disabled={busy} onClick={() => void run('access.set', { agreementId: a.id, operatorId: g.operator_id, grant: 'revoke' })}>Remove</button>}</li>) : <li className="lk-muted">No one beyond the default people.</li>}</ul>
            {can(state, 'owner', 'counsel') && (
              <Form busy={busy} submit="Grant access" onSubmit={data => void run('access.set', { agreementId: a.id, operatorId: value(data, 'operatorId'), grant: 'grant' })}>
                <Field label="Person"><select name="operatorId">{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              </Form>
            )}
          </>
        ) : <p className="lk-muted">Everyone with a Locket role can see this agreement. Mark it restricted to limit access.</p>}
        <div className="lk-panel-head"><h2>History</h2></div>
        <ul className="lk-log">{audit.map(x => <li key={x.id}><time>{when(x.at)}</time><span><strong>{x.actor_name}</strong> ({roleLabel[x.actor_role] ?? x.actor_role}) {x.summary}</span></li>)}</ul>
      </section>
    </div>
  )
}
