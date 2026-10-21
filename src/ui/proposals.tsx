import { useState } from 'react'
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { CustomFieldInputs, customValueLabel, mayEditField, readCustomValues } from './custom-field-values'
import { Avatar, Badge, EmptyState, Field, Form, value } from './controls'
import { isAgent, money, parse, partyName, personName, roleLabel, termLabel, termValue, when, words } from './format'

const kindLabel: Record<string, string> = { intake: 'Intake extraction', review: 'Playbook review', family: 'Agreement family links', terms: 'Terms and obligations', renewal: 'Renewal notice', custom_fields: 'Custom metadata' }
const deciders: Record<string, string[]> = { intake: ['owner', 'counsel', 'approver', 'requester'], review: ['owner', 'counsel'], family: ['owner', 'counsel'], terms: ['owner', 'counsel', 'approver'], renewal: ['owner', 'approver'], custom_fields: ['owner', 'counsel', 'approver', 'requester', 'viewer'] }

function Changes({ p, state }: { p: Row; state: LocketState }) {
  const payload = parse(p.payload)
  const version = state.versions.find(v => v.id === payload.versionId)
  if (p.kind === 'custom_fields') return <><ul className="lk-changes">{Object.entries(payload.values).map(([id, value]) => {
    const field = state.customFields.find(f => f.id === id)
    return <li key={id}>{field ? `${field.name}: ${customValueLabel(state, field, value, false)}` : 'Custom field unavailable'}</li>
  })}</ul><blockquote>{payload.citation.quote}</blockquote><p>{version && <a href={`#agreement/${p.agreement_id}/versions/${version.number}/${payload.citation.start}/${payload.citation.end}`}>Review cited passage in v{version.number}</a>}</p></>
  if (p.kind === 'intake') return <ul className="lk-changes"><li>Create “{payload.title}” ({words(payload.type ?? 'other')})</li><li>Counterparty: {payload.party?.name ?? 'existing party'}</li>{payload.value && <li>Value: {Number.isFinite(Number(payload.value)) ? money(Math.round(Number(payload.value) * 100)) : payload.value} USD</li>}{payload.templateVersionId && <li>Populate an approved template</li>}</ul>
  if (p.kind === 'review') return <ul className="lk-changes">{(payload.findings ?? []).map((f: any, i: number) => <li key={i}><strong>{f.clauseKey}</strong>: {f.result === 'met' ? 'rule met' : f.result === 'breached' ? 'rule breached' : 'cannot determine'} — “{f.quote}”{f.proposedWording ? <em> → {f.proposedWording}</em> : null}</li>)}</ul>
  if (p.kind === 'family') return <ul className="lk-changes"><li>Link as {words(payload.relation ?? '')} of another agreement</li>{(payload.contradictions ?? []).map((c: string) => <li key={c}>Contradiction: {c}</li>)}</ul>
  if (p.kind === 'terms') return <ul className="lk-changes">{(payload.terms ?? []).map((t: any) => <li key={t.key}>{termLabel[t.key] ?? words(t.key)}: {termValue(t.key, t.value)} — “{t.citation?.quote}”{t.citation?.page ? ` (page ${t.citation.page})` : ''}</li>)}</ul>
  return <ul className="lk-changes"><li>Notice to {payload.recipient}</li><li><pre className="lk-document">{payload.body}</pre></li></ul>
}

export function Proposals({ state, locket }: { state: LocketState; locket: Locket }) {
  const [filter, setFilter] = useState('pending')
  const list = state.proposals.filter(p => !filter || p.status === filter)
  const [selected, setSelected] = useState('')
  const open = list.find(x => x.id === selected) ?? list[0]
  return (
    <div className="lk-proposals">
      <div className="lk-titlebar"><div><h1>Proposals</h1><p className="lk-muted">Work an agent prepared. Nothing changes until a person with the right authority approves it; approval runs the same checks as doing the work by hand.</p></div></div>
      <div className="lk-filters">{['pending', 'approved', 'rejected', ''].map(f => <button key={f || 'all'} type="button" className={`lk-filter${filter === f ? ' lk-selected' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f ? words(f) : 'All'} <strong>{state.proposals.filter(x => !f || x.status === f).length}</strong></button>)}</div>
      {list.length === 0 ? <section className="lk-panel"><EmptyState title="No proposals here.">An agent signed in with the agent role prepares them through the Locket API. See Agents and the API in the docs.</EmptyState></section> : (
        <ol className="lk-inbox">{list.map(p => <ProposalCard key={p.id} state={state} p={p} open={p.id === open?.id} onOpen={() => setSelected(p.id)} locket={locket} />)}</ol>
      )}
    </div>
  )
}

function ProposalCard({ state, p, open, onOpen, locket }: { state: LocketState; p: Row; open: boolean; onOpen: () => void; locket: Locket }) {
  const { run, busy } = locket
  const agreement = p.agreement_id ? state.agreements.find(a => a.id === p.agreement_id) : null
  const payload = parse(p.payload)
  const proposedIds = p.kind === 'custom_fields' ? Object.keys(payload.values) : []
  const customFields = state.customFields.filter(f => proposedIds.includes(f.id))
  const fieldAuthority = p.kind !== 'custom_fields' || (customFields.length === proposedIds.length && customFields.every(f => mayEditField(state, f)))
  const mayDecide = fieldAuthority && deciders[p.kind].includes(state.actor.role) && (p.prepared_by !== state.actor.id || state.actor.role === 'owner')
  const by = personName(state, p.prepared_by)
  return (
    <li className={`lk-proposal${open ? ' lk-open' : ''}`}>
      <div className="lk-proposal-head">
        <Avatar name={by} agent={isAgent(state, p.prepared_by)} large />
        <span>
          <button type="button" className="lk-linklike" aria-expanded={open} onClick={onOpen}>{agreement ? `${agreement.title} — ` : ''}{kindLabel[p.kind]}</button>
          <small>Prepared by {by} · {when(p.prepared_at)}</small>
        </span>
        <Badge value={p.status} />
      </div>
      {open && (
        <div className="lk-proposal-body">
          {agreement && <p className="lk-meta"><a href={`#agreement/${agreement.id}`}>{agreement.reference} {agreement.title}</a> · {partyName(state, agreement.party_id)}</p>}
          <h3>Proposed changes</h3>
          <Changes p={p} state={state} />
          <h3>Evidence</h3>
          <ul className="lk-changes">{parse<string[]>(p.evidence).map(e => <li key={e}>{e}</li>)}</ul>
          {p.assumptions && <><h3>Assumptions and open questions</h3><p>{p.assumptions}</p></>}
          {p.status === 'pending' ? (mayDecide ? (
            <Form busy={busy} submit="Record decision" onSubmit={data => void run('proposal.decide', { proposalId: p.id, decision: value(data, 'decision'), reason: value(data, 'reason') || undefined, ...(p.kind === 'custom_fields' && value(data, 'decision') === 'approve' ? { values: readCustomValues(data, customFields) } : {}) })}>
              {p.kind === 'custom_fields' && <fieldset className="lk-fieldset"><legend>Review or correct proposed values</legend><CustomFieldInputs state={state} fields={customFields} values={payload.values} stored={false} /></fieldset>}
              <div className="lk-segmented"><label><input type="radio" name="decision" value="approve" defaultChecked /> Approve</label><label><input type="radio" name="decision" value="reject" /> Reject</label></div>
              <Field label="Comment (optional)"><textarea name="reason" rows={2} /></Field>
            </Form>
          ) : <p className="lk-muted">Decided by {p.kind === 'custom_fields' ? 'a person allowed to edit every proposed field' : deciders[p.kind].map(r => roleLabel[r]).join(', ')}{p.prepared_by === state.actor.id ? ', and not by the preparer' : ''}.</p>) : (
            <p>{p.status === 'approved' ? 'Approved' : 'Rejected'} by {personName(state, p.decided_by)} {when(p.decided_at)}{p.decision_reason ? ` — ${p.decision_reason}` : ''}</p>
          )}
        </div>
      )}
    </li>
  )
}
