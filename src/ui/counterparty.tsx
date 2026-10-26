import { PrivacyAccess } from './privacy-access'
import { EraseContact } from './erasure'
// A counterparty's page (REPO-010): its legal details, notice address and
// method, contacts and signatories, the agreements this person may see grouped
// by family with contracted and annual USD value and the next notice deadline,
// open obligations and the risk they roll up to (OBL-002), and merging.
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Badge, Empty, Field, Form, Icon, Person, value } from './controls'
import { can, day, deadline, money, parse, personName, statusLabel, typeLabel, words } from './format'

type Contact = { name: string; email: string; title?: string | null }
/** "Name | email | Title" per line. */
const peopleFrom = (text: string) => text.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [name, email, title] = l.split('|').map(s => s.trim()); return { name, email, ...(title ? { title } : {}) } })
const peopleText = (rows: Contact[]) => rows.map(r => [r.name, r.email, r.title].filter(Boolean).join(' | ')).join('\n')
const methodLabel: Record<string, string> = { email: 'Email', post: 'Post', courier: 'Courier', hand: 'By hand' }

const riskWord = (risk: string) => words(risk)

/** An obligation's rating, and the raised rating while it is overdue. */
export function RiskLabel({ state, o }: { state: LocketState; o: Row }) {
  const r = state.risk.obligations[o.id]
  if (!r) return <>{riskWord(o.risk)}</>
  return <>{riskWord(r.risk)}{r.overdue && <small> raised from {r.rated}: overdue</small>}</>
}

const rolled = (r: { risk: string; overdue: number } | null | undefined) => (r ? `${riskWord(r.risk)}${r.overdue ? ` (raised: ${r.overdue} overdue obligation${r.overdue === 1 ? '' : 's'})` : ''}` : 'No open obligations')

export function Counterparty({ state, id, locket }: { state: LocketState; id: string; locket: Locket }) {
  const found = state.parties.find(p => p.id === id)
  const party = found?.merged_into ? state.parties.find(p => p.id === found.merged_into) : found
  if (!party) return <Empty>No counterparty you can see has that identity.</Empty>
  const agreements = state.agreements.filter(a => a.party_id === party.id)
  const open = state.obligations.filter(o => o.status === 'confirmed' && agreements.some(a => a.id === o.agreement_id))
  const summary = state.counterparties[party.id]
  const merged = state.parties.filter(p => p.merged_into === party.id)
  const contacts = parse<Contact[]>(party.contacts ?? '[]'), signers = parse<Contact[]>(party.signatories ?? '[]')
  const title = (ids: string[]) => ids.map(x => agreements.find(a => a.id === x)?.title).filter(Boolean).join(', ')
  return (
    <div className="lk-tab-page">
      <a className="lk-back" href="#agreements"><Icon name="back" />Back to agreements</a>
      <div className="lk-titlebar"><div><h1>{party.name}</h1><p className="lk-muted">{words(party.kind)}{party.tax_id ? ` · ${party.tax_id_kind === 'ein' ? 'EIN' : 'Tax ID'} ${party.tax_id}` : ''}{party.email ? ` · ${party.email}` : ''}</p>{found !== party && <p className="lk-note">{found!.name} was merged into {party.name}.</p>}</div></div>
      {(state.accountingLinks.some(l=>agreements.some(a=>a.id===l.agreement_id))||state.accountingSchedules.some(r=>agreements.some(a=>a.id===r.agreement_id)))&&<section className="lk-panel" aria-label="Accounting records"><h2>Accounting records</h2>
        {state.accountingLinks.filter(l=>agreements.some(a=>a.id===l.agreement_id)).map(l=><p key={l.agreement_id}>{l.provider==='pantry'?'Pantry':l.provider==='netsuite'?'NetSuite':'QuickBooks'} {l.record_kind==='customer'?'customer':'vendor'} {l.vendor_id} · <a href={`#agreement/${l.agreement_id}/terms`}>{agreements.find(a=>a.id===l.agreement_id)?.reference}</a></p>)}
        {state.accountingSchedules.filter(r=>agreements.some(a=>a.id===r.agreement_id)).map(r=><p key={r.id} style={{overflowWrap:'anywhere'}}>Pantry {parse<any>(r.payload).customerId?'customer':'vendor'} {parse<any>(r.payload).customerId??parse<any>(r.payload).vendorId} · {r.origin} · {r.remote_id?`bill ${r.remote_id}`:'proposed bill'} · <a href={`#agreement/${r.agreement_id}/terms`}>{agreements.find(a=>a.id===r.agreement_id)?.reference}</a></p>)}
      </section>}
      <section className="lk-panel" aria-labelledby="lk-party-details">
        <div className="lk-panel-head"><h2 id="lk-party-details">Details</h2></div>
        <dl className="lk-obligation-facts">
          <div><dt>Entity type</dt><dd>{party.entity_type ?? '—'}</dd></div>
          <div><dt>Formed in</dt><dd>{party.formation ?? '—'}</dd></div>
          <div><dt>Registered address</dt><dd>{party.registered_address ?? '—'}</dd></div>
          <div><dt>Notice address</dt><dd>{party.notice_address ?? '—'}{party.notice_method && <small> by {methodLabel[party.notice_method].toLowerCase()}</small>}</dd></div>
          <div><dt>Contacts</dt><dd>{contacts.length ? contacts.map(c => c.email.endsWith('@invalid.example') ? c.name : `${c.name} <${c.email}>${c.title ? `, ${c.title}` : ''}`).join('; ') : '—'}</dd></div>
          <div><dt>Authorized signatories</dt><dd>{signers.length ? signers.map(c => `${c.name}, ${c.title}`).join('; ') : '—'}<small> as recorded; Locket does not validate signing authority</small></dd></div>
        </dl>
        {merged.length > 0 && <p className="lk-muted">Merged into this record: {merged.map(m => `${m.name} (${m.merge_reason})`).join('; ')}</p>}
        {can(state, 'owner', 'counsel', 'approver', 'requester') && <PartyForm party={party} locket={locket} />}
      </section>
      <section className="lk-panel" aria-labelledby="lk-party-value">
        <div className="lk-panel-head"><h2 id="lk-party-value">Contracted value and deadlines</h2></div>
        <dl className="lk-obligation-facts">
          <div><dt>Total contracted</dt><dd data-party-total>{state.fieldAccess.hidden.includes('value')?'Hidden':money(summary?.totalCents??0)+' USD'}</dd></div>
          <div><dt>Annual contracted</dt><dd data-party-annual>{state.fieldAccess.hidden.includes('value')?'Hidden':money(summary?.annualCents??0)+' USD'}</dd></div>
          <div><dt>Next notice deadline</dt><dd data-party-deadline>{summary?.nextDeadline ? <a href={`#agreement/${summary.nextDeadline.agreementId}/terms`}>{deadline(summary.nextDeadline.at, summary.nextDeadline.timezone)}</a> : 'None open'}</dd></div>
        </dl>
        {summary && summary.unvalued.length + summary.undated.length > 0 && <p className="lk-muted">{summary.unvalued.length ? `Not counted (no value): ${title(summary.unvalued)}. ` : ''}{summary.undated.length ? `Not in the annual figure (no confirmed effective and end dates): ${title(summary.undated)}.` : ''}</p>}
      </section>
      <section className="lk-panel" aria-labelledby="lk-party-risk">
        <div className="lk-panel-head"><h2 id="lk-party-risk">Obligation risk</h2></div>
        <p data-party-risk={state.risk.parties[id]?.risk ?? 'none'}>Risk: {rolled(state.risk.parties[id])}</p>
        {open.length === 0 ? <Empty>No open obligations.</Empty> : (
          <ul className="lk-obligations">{open.map(o => (
            <li key={o.id}>
              <div className="lk-finding-head"><strong>{o.description}</strong><Badge value={state.risk.obligations[o.id]?.overdue ? 'overdue' : o.status} /></div>
              <dl className="lk-obligation-facts">
                <div><dt>Agreement</dt><dd><a href={`#agreement/${o.agreement_id}/terms`}>{agreements.find(a => a.id === o.agreement_id)?.title}</a></dd></div>
                <div><dt>Owner</dt><dd><Person name={personName(state, o.owner_id)} /></dd></div>
                <div><dt>Due</dt><dd>{day(o.due_date)}</dd></div>
                <div><dt>Risk</dt><dd><RiskLabel state={state} o={o} /></dd></div>
              </dl>
            </li>
          ))}</ul>
        )}
      </section>
      <section className="lk-panel" aria-labelledby="lk-party-agreements">
        <div className="lk-panel-head"><h2 id="lk-party-agreements">Agreements</h2></div>
        {(summary?.families ?? []).map(f => (
          <ul key={f.rootId} className="lk-list" aria-label={`Family of ${state.agreements.find(a => a.id === f.rootId)?.title ?? 'an agreement'}`}>{f.ids.map(x => agreements.find(a => a.id === x)).filter(Boolean).map(a => <li key={a!.id}><span>{a!.id !== f.rootId && '↳ '}<a href={`#agreement/${a!.id}`}>{a!.title}</a> · {typeLabel[a!.type]} · {statusLabel[a!.status] ?? a!.status} · {a!.value_cents === null ? 'no value' : `${money(a!.value_cents)} USD`} · risk {rolled(state.risk.agreements[a!.id])}</span></li>)}</ul>
        ))}
      </section>
      <PrivacyAccess state={state} party={party} locket={locket}/>
      <EraseContact state={state} party={party} locket={locket}/>
      {can(state, 'owner', 'counsel') && <MergeParty state={state} party={party} locket={locket} />}
    </div>
  )
}

function PartyForm({ party, locket }: { party: Row; locket: Locket }) {
  return (
    <details className="lk-disclosure">
      <summary>Edit counterparty</summary>
      <Form key={party.version} busy={locket.busy} submit="Save counterparty" onSubmit={data => void locket.run('party.save', {
        id: party.id, version: party.version, name: value(data, 'name'), kind: value(data, 'kind'), email: value(data, 'email') || undefined,
        ...(value(data, 'taxId') ? { taxIdKind: value(data, 'taxIdKind'), taxId: value(data, 'taxId') } : {}),
        entityType: value(data, 'entityType') || undefined, formation: value(data, 'formation') || undefined, registeredAddress: value(data, 'registeredAddress') || undefined,
        noticeAddress: value(data, 'noticeAddress') || undefined, noticeMethod: value(data, 'noticeMethod') || undefined,
        contacts: peopleFrom(value(data, 'contacts')), signatories: peopleFrom(value(data, 'signatories')),
      })}>
        <div className="lk-grid2">
          <Field label="Legal name *"><input name="name" defaultValue={party.name} required /></Field>
          <Field label="Kind"><select name="kind" defaultValue={party.kind}><option value="customer">Customer</option><option value="supplier">Supplier</option><option value="partner">Partner</option><option value="other">Other</option></select></Field>
          <Field label="Entity type" hint="e.g. Corporation, LLC"><input name="entityType" defaultValue={party.entity_type ?? ''} /></Field>
          <Field label="State or country of formation"><input name="formation" defaultValue={party.formation ?? ''} /></Field>
          <Field label="Tax ID kind"><select name="taxIdKind" defaultValue={party.tax_id_kind ?? 'ein'}><option value="ein">EIN</option><option value="foreign">Foreign tax ID</option></select></Field>
          <Field label="Tax ID" hint="EIN as 12-3456789"><input name="taxId" defaultValue={party.tax_id ?? ''} /></Field>
          <Field label="Email"><input name="email" type="email" defaultValue={party.email ?? ''} /></Field>
          <Field label="Notice method"><select name="noticeMethod" defaultValue={party.notice_method ?? ''}><option value="">Not recorded</option>{Object.entries(methodLabel).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        </div>
        <Field label="Registered address"><textarea name="registeredAddress" rows={2} defaultValue={party.registered_address ?? ''} /></Field>
        <Field label="Notice address"><textarea name="noticeAddress" rows={2} defaultValue={party.notice_address ?? ''} /></Field>
        <Field label="Contacts" hint="One per line: Name | email | Title"><textarea name="contacts" rows={2} defaultValue={peopleText(parse<Contact[]>(party.contacts ?? '[]'))} /></Field>
        <Field label="Authorized signatories" hint="One per line: Name | email | Title"><textarea name="signatories" rows={2} defaultValue={peopleText(parse<Contact[]>(party.signatories ?? '[]'))} /></Field>
      </Form>
    </details>
  )
}

function MergeParty({ state, party, locket }: { state: LocketState; party: Row; locket: Locket }) {
  const others = state.parties.filter(p => p.id !== party.id && !p.merged_into)
  if (!others.length) return null
  return (
    <section className="lk-panel" aria-labelledby="lk-party-merge">
      <div className="lk-panel-head"><h2 id="lk-party-merge">Merge a duplicate</h2><span className="lk-muted">Its agreements move here; any still in negotiation lose their approvals. The duplicate stays as history.</span></div>
      <Form busy={locket.busy} submit="Merge into this counterparty" onSubmit={data => {
        const duplicate = others.find(p => p.id === value(data, 'duplicateId'))!
        void locket.run('party.merge', { keepId: party.id, keepVersion: party.version, duplicateId: duplicate.id, duplicateVersion: duplicate.version, reason: value(data, 'reason') })
      }}>
        <Field label="Duplicate counterparty"><select name="duplicateId">{others.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Why they are the same *"><input name="reason" required /></Field>
      </Form>
    </section>
  )
}
