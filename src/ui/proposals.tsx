import { useState } from 'react'
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Badge, EmptyState, Field, Form, value } from './controls'
import { money, parse, personName, roleLabel, termLabel, termValue, when, words } from './format'

const kindLabel: Record<string, string> = { intake: 'Intake extraction', review: 'Playbook review', family: 'Agreement family links', terms: 'Terms and obligations', renewal: 'Renewal notice' }
const deciders: Record<string, string[]> = { intake: ['owner', 'counsel', 'approver', 'requester'], review: ['owner', 'counsel'], family: ['owner', 'counsel'], terms: ['owner', 'counsel', 'approver'], renewal: ['owner', 'approver'] }

function Changes({ p }: { p: Row }) {
  const payload = parse(p.payload)
  if (p.kind === 'intake') return <ul className="lk-changes"><li>Create “{payload.title}” ({words(payload.type ?? 'other')})</li><li>Counterparty: {payload.party?.name ?? 'existing party'}</li>{payload.value && <li>Value: {Number.isFinite(Number(payload.value)) ? money(Math.round(Number(payload.value) * 100)) : payload.value} AUD</li>}{payload.templateVersionId && <li>Populate an approved template</li>}</ul>
  if (p.kind === 'review') return <ul className="lk-changes">{(payload.findings ?? []).map((f: any, i: number) => <li key={i}><strong>{f.clauseKey}</strong>: {f.result === 'met' ? 'rule met' : f.result === 'breached' ? 'rule breached' : 'cannot determine'} — “{f.quote}”{f.proposedWording ? <em> → {f.proposedWording}</em> : null}</li>)}</ul>
  if (p.kind === 'family') return <ul className="lk-changes"><li>Link as {words(payload.relation ?? '')} of another agreement</li>{(payload.contradictions ?? []).map((c: string) => <li key={c}>Contradiction: {c}</li>)}</ul>
  if (p.kind === 'terms') return <ul className="lk-changes">{(payload.terms ?? []).map((t: any) => <li key={t.key}>{termLabel[t.key] ?? words(t.key)}: {termValue(t.key, t.value)} — “{t.citation?.quote}”{t.citation?.page ? ` (page ${t.citation.page})` : ''}</li>)}</ul>
  return <ul className="lk-changes"><li>Notice to {payload.recipient}</li><li><pre className="lk-document">{payload.body}</pre></li></ul>
}

export function Proposals({ state, locket }: { state: LocketState; locket: Locket }) {
  const { run, busy } = locket
  const [filter, setFilter] = useState('pending')
  const list = state.proposals.filter(p => !filter || p.status === filter)
  const [selected, setSelected] = useState('')
  const p = list.find(x => x.id === selected) ?? list[0]
  const agreement = p?.agreement_id ? state.agreements.find(a => a.id === p.agreement_id) : null
  const mayDecide = p && deciders[p.kind].includes(state.actor.role) && (p.prepared_by !== state.actor.id || state.actor.role === 'owner')
  return (
    <div className="lk-proposals">
      <div className="lk-titlebar"><div><h1>Proposals</h1><p className="lk-muted">Work an agent prepared. Nothing changes until a person with the right authority approves it; approval runs the same checks as doing the work by hand.</p></div></div>
      <div className="lk-filters">{['pending', 'approved', 'rejected', ''].map(f => <button key={f || 'all'} type="button" className={`lk-filter${filter === f ? ' lk-selected' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f ? words(f) : 'All'} <strong>{state.proposals.filter(x => !f || x.status === f).length}</strong></button>)}</div>
      <div className={p ? 'lk-split' : undefined}>
        <section className="lk-panel lk-table-panel">
          {list.length === 0 ? <EmptyState title="No proposals here.">An agent signed in with the agent role prepares them through the Locket API. See Agents and the API in the docs.</EmptyState> : (
            <ul className="lk-pick-list">{list.map(x => {
              const ag = x.agreement_id ? state.agreements.find(a => a.id === x.agreement_id) : null
              return <li key={x.id}><button type="button" className={x.id === p?.id ? 'lk-selected' : undefined} onClick={() => setSelected(x.id)}><strong>{ag ? `${ag.title} — ` : ''}{kindLabel[x.kind]}</strong><small>Prepared by {personName(state, x.prepared_by)} · {when(x.prepared_at)}</small><Badge value={x.status} /></button></li>
            })}</ul>
          )}
        </section>
        {p && (
          <aside className="lk-panel lk-side">
            <div className="lk-side-head"><h2>{kindLabel[p.kind]}</h2><Badge value={p.status} /></div>
            {agreement && <p className="lk-meta"><a href={`#agreement/${agreement.id}`}>{agreement.reference} {agreement.title}</a></p>}
            <h3>Proposed changes</h3>
            <Changes p={p} />
            <h3>Evidence</h3>
            <ul className="lk-changes">{parse<string[]>(p.evidence).map(e => <li key={e}>{e}</li>)}</ul>
            {p.assumptions && <><h3>Assumptions and open questions</h3><p>{p.assumptions}</p></>}
            {p.status === 'pending' ? (mayDecide ? (
              <Form busy={busy} submit="Record decision" onSubmit={data => void run('proposal.decide', { proposalId: p.id, decision: value(data, 'decision'), reason: value(data, 'reason') || undefined })}>
                <div className="lk-segmented"><label><input type="radio" name="decision" value="approve" defaultChecked /> Approve</label><label><input type="radio" name="decision" value="reject" /> Reject</label></div>
                <Field label="Comment (optional)"><textarea name="reason" rows={2} /></Field>
              </Form>
            ) : <p className="lk-muted">Decided by {deciders[p.kind].map(r => roleLabel[r]).join(', ')}{p.prepared_by === state.actor.id ? ', and not by the preparer' : ''}.</p>) : (
              <p>{p.status === 'approved' ? 'Approved' : 'Rejected'} by {personName(state, p.decided_by)} {when(p.decided_at)}{p.decision_reason ? ` — ${p.decision_reason}` : ''}</p>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
