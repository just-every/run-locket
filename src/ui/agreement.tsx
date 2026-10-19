// One agreement: the document workspace (its default), and the review,
// approval, signature, execution, terms and access tabs under the same head.
import { ClauseProvenance } from './clause-library'
import { useState } from 'react'
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Avatar, Badge, Empty, Field, Form, Icon, Person, value } from './controls'
import { DocumentPage, useRedline } from './document'
import { AssignEntity, entityName } from './entities'
import { brief, can, currentVersion, day, parse, partyName, personName, plural, roleLabel, stamp, typeLabel, versionName, versionsOf, when } from './format'
import { Approvals, Review } from './review'
import { AgentPlace, TopTools } from './shell'
import { Execution, Signature } from './signature'
import { liveApprovals } from './summary'
import { Family } from './family'
import { Terms } from './terms'
import { AddVersion, Attachments, Comments, VersionChips } from './versions'

const tabs = [
  { id: 'versions', title: 'Document' },
  { id: 'review', title: 'Review' },
  { id: 'approvals', title: 'Approvals' },
  { id: 'signature', title: 'Signature' },
  { id: 'execution', title: 'Execution' },
  { id: 'terms', title: 'Terms and obligations' },
  { id: 'family', title: 'Family' },
  { id: 'details', title: 'Details and access' },
]
const fileLabel: Record<string, string> = { original: 'Original', rendition: 'Signing PDF', signed: 'Signed PDF', package: 'Signature-ready PDF', manifest: 'Routing manifest' }

export function AgreementPage({ state, id, tab, shown: shownNumber, locket }: { state: LocketState; id: string; tab: string; shown: string; locket: Locket }) {
  const a = state.agreements.find(x => x.id === id)
  const versions = a ? versionsOf(state, a.id) : []
  const current = a ? currentVersion(state, a) : null
  const shown = versions.find(v => String(v.number) === shownNumber) ?? current
  const [baseNumber, setBaseNumber] = useState<number | null | undefined>(undefined)
  const base = baseNumber === null ? null : versions.find(v => v.number === (baseNumber ?? (shown ? shown.number - 1 : 0))) ?? null
  const [adding, setAdding] = useState(false)
  const marked = useRedline(base, shown)
  if (!a) return <Empty>No agreement you can access has this link. <a href="#agreements">Back to agreements</a></Empty>
  const selected = tabs.some(t => t.id === tab) ? tab : 'versions'
  const parent = a.parent_id ? state.agreements.find(x => x.id === a.parent_id) : null
  // The shown version's own file: the original upload, the signing PDF, or the signed PDF an import kept.
  const files = shown ? state.artifacts.filter(f => f.version_id === shown.id && ['original', 'rendition', 'signed'].includes(f.role)) : []
  const original = files.find(f => f.role === 'original') ?? files.find(f => f.role === 'signed') ?? files.find(f => f.role === 'rendition')
  const route = state.routes[a.id] ?? []
  const live = liveApprovals(state, a)
  const decided = route.filter(step => live.some(x => x.kind === step.kind && (x.deviation_id ?? null) === (step.deviationId ?? null))).length
  const comments = shown ? state.comments.filter(c => c.version_id === shown.id).length : 0
  const docx = original?.filename?.toLowerCase().endsWith('.docx')
  return (
    <div className="lk-agreement">
      <TopTools><VersionChips state={state} a={a} shown={shown} base={base} onBase={n => setBaseNumber(n)} adding={adding} onAdding={setAdding} /></TopTools>
      {shown && <AgentPlace><AgentReply state={state} a={a} shown={shown} original={original} /></AgentPlace>}
      <div className="lk-doc-head">
        <div className="lk-doc-title">
          <h1>{original && <span className={`lk-file-icon${docx ? '' : ' lk-file-pdf'}`} aria-hidden="true">{docx ? 'W' : 'PDF'}</span>}{original?.filename ?? a.title}</h1>
          <p className="lk-counts">
            {[base && marked ? plural(marked.changes, 'tracked change') + ` from v${base.number}` : shown ? `v${shown.number} · ${shown.kind === 'template' ? 'from template ' : ''}${versionName(state, shown)}` : 'No document yet', plural(comments, 'comment'), route.length ? `${decided} of ${route.length} approvals decided` : ''].filter(Boolean).join(' · ')}
          </p>
          {route.length > 0 && <div className="lk-progress" role="progressbar" aria-label="Approvals decided" aria-valuemin={0} aria-valuemax={route.length} aria-valuenow={decided}><span style={{ width: `${(decided / route.length) * 100}%` }} /></div>}
          {parent && <p className="lk-muted">{a.relation?.replace('_', ' ')} <a href={`#agreement/${parent.id}`}>{parent.reference} {parent.title}</a></p>}
        </div>
        <dl className="lk-doc-meta">
          <div><dt>Needed by</dt><dd>{day(a.needed_by)}</dd></div>
          <div><dt>Counterparty</dt><dd>{partyName(state, a.party_id)}</dd></div>
          {state.entities.length > 0 && <div><dt>Our entity</dt><dd>{entityName(state, a.entity_id)}<AssignEntity state={state} a={a} locket={locket} /></dd></div>}
          <div><dt>Owner</dt><dd><Person name={personName(state, a.owner_id)} /></dd></div>
          <div><dt>Last updated</dt><dd>{stamp(a.updated_at, { zone: a.timezone })}</dd></div>
        </dl>
      </div>
      <div className="lk-doc-bar">
        <nav className="lk-tabs" aria-label="Agreement sections">
          {tabs.map(t => <a key={t.id} href={`#agreement/${a.id}/${t.id}`} className={t.id === selected ? 'lk-selected' : undefined} aria-current={t.id === selected ? 'page' : undefined}>{t.title}</a>)}
        </nav>
        <p className="lk-subtitle"><Badge value={a.status} /><span>{typeLabel[a.type]} · {a.reference}{a.restricted ? ' · restricted' : ''}</span>{files.map(f => <a key={f.id} className="lk-file-link" href={`/api/locket/files/${f.id}`} title={`${f.filename} · sha256 ${f.sha256}`} download><Icon name="file" />{fileLabel[f.role] ?? f.filename}</a>)}</p>
      </div>
      {selected === 'versions' && (
        <>
          {(adding || versions.length === 0) && <AddVersion state={state} a={a} locket={locket} onDone={() => setAdding(false)} />}
          {(a.status === 'draft' || state.requirements.some(r => r.agreement_id === a.id && !r.artifact_id && !r.waived_reason)) && <Attachments state={state} a={a} locket={locket} />}
          {shown && <ClauseProvenance version={shown} />}
          {shown ? <DocumentPage state={state} a={a} base={base} shown={shown} locket={locket} /> : <Empty>Add a version to see its text.</Empty>}
          {shown && <Comments state={state} a={a} shown={shown} locket={locket} />}
          {a.status !== 'draft' && !state.requirements.some(r => r.agreement_id === a.id && !r.artifact_id && !r.waived_reason) && state.requirements.some(r => r.agreement_id === a.id) && <Attachments state={state} a={a} locket={locket} />}
        </>
      )}
      {selected === 'review' && <Review state={state} a={a} locket={locket} />}
      {selected === 'approvals' && <Approvals state={state} a={a} locket={locket} />}
      {selected === 'signature' && <Signature state={state} a={a} locket={locket} />}
      {selected === 'execution' && <Execution state={state} a={a} locket={locket} />}
      {selected === 'terms' && <Terms state={state} a={a} locket={locket} />}
      {selected === 'family' && <Family state={state} a={a} locket={locket} />}
      {selected === 'details' && <Details state={state} a={a} locket={locket} />}
    </div>
  )
}

/** The agent's place in the command bar: how the shown version reads against the playbook, and its file's seal. */
function AgentReply({ state, a, shown, original }: { state: LocketState; a: Row; shown: Row; original: Row | undefined }) {
  const findings = state.deviations.filter(d => d.version_id === shown.id)
  const playbook = state.playbooks.find(p => p.id === findings[0]?.playbook_version_id) ?? state.playbooks.find(p => p.status === 'active')
  const rules = playbook ? parse<any[]>(playbook.rules).length : 0
  const met = new Set(findings.filter(d => d.result === 'met').map(d => d.clause_key)).size
  const clause = (d: Row) => shown.text?.slice(0, d.start_offset).split('\n').at(-1)?.match(/^(\d+\.\d+)\s/)?.[1]
  // Still-open breaches first: the one waiting on a decision leads.
  const decided = (d: Row) => liveApprovals(state, a).some(x => x.kind === 'exception' && x.deviation_id === d.id)
  const breached = findings.filter(d => d.result === 'breached').sort((x, y) => Number(decided(x)) - Number(decided(y))).map(d => (clause(d) ? `§${clause(d)}` : d.clause_key))
  return (
    <>
      <a className="lk-agent-chip" href={`#agreement/${a.id}/review`}>
        <img src="/brand/mark.svg" alt="" />
        <span>{findings.length && playbook ? `v${shown.number} vs playbook v${playbook.number}: ${met} of ${rules} met${breached.length ? ` · ${breached.join(', ')} breached` : ''}` : `v${shown.number} has no playbook review yet`}</span>
        <Icon name="arrow" />
      </a>
      {original && <p className="lk-seal" title={`v${shown.number} · ${versionName(state, shown)} · ${original.filename} · sha256 ${original.sha256}`}><span>v{shown.number} · {brief(versionName(state, shown))}</span><span>· sha256 {original.sha256.slice(0, 4)}…{original.sha256.slice(-4)} · original kept</span><Icon name="check" /></p>}
    </>
  )
}

function Details({ state, a, locket }: { state: LocketState; a: Row; locket: Locket }) {
  const { run, busy } = locket
  const grants = state.access.filter(x => x.agreement_id === a.id)
  const people = state.operators.filter(o => o.status === 'active')
  const audit = state.audit.filter(x => x.agreement_id === a.id)
  const editable = can(state, 'owner', 'counsel', 'approver', 'requester') && ['draft', 'in_review', 'approved'].includes(a.status)
  return (
    <div className="lk-tab-page">
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
            <ul className="lk-list">{grants.length ? grants.map(g => <li key={g.operator_id}><Avatar name={personName(state, g.operator_id)} /><Person name={personName(state, g.operator_id)} />{can(state, 'owner', 'counsel') && <button type="button" className="lk-small" disabled={busy} onClick={() => void run('access.set', { agreementId: a.id, operatorId: g.operator_id, grant: 'revoke' })}>Remove</button>}</li>) : <li className="lk-muted">No one beyond the default people.</li>}</ul>
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
