import { AccountingAllocation } from './accounting-allocation'
import { AccountingSchedules } from './accounting-schedules'
import { RenewalHistory } from './renewal-history'
import { ObligationRemediation } from './obligation-remediation'
import { InvoiceReconciliation } from './reconciliation'
import { ServiceLevels } from './service-levels'
import { ServicePerformance } from './service-performance'
import { FamilyBlock } from './family-analysis'
import { metadataTermLabel, metadataTermValue } from './custom-field-values'
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Badge, Empty, Field, Form, Person, value, When } from './controls'
import { DeadlineReminderLog } from './deadline-reminders'
import { can, day, deadline, parse, personName, renewalOf, termLabel, words } from './format'
import { usJurisdictions } from '../locket/us-defaults'
import { fileToPayload } from './api'
import { RiskLabel } from './counterparty'

const keys = ['effective_date', 'end_date', 'initial_term_months', 'auto_renew', 'renewal_type', 'renewal_term_months', 'renewals_allowed', 'notice_days', 'governing_law', 'payment_terms']
const unread = (c: any) => (c.signedText === 'unreadable' ? ' (the signed PDF has no readable text; not checked against it)' : '')
const cite = (c: any) => (c.source === 'family-governing' ? `Counsel-confirmed family source: “${c.quote}”${c.page ? ` (page ${c.page})` : ''}` : c.source === 'custom-field-passage' ? `Document v${c.versionNumber}: “${c.quote}” (characters ${c.start}–${c.end})` : c.source === 'import-manifest' ? `Import manifest row ${c.row} (not yet checked against the signed PDF)`
  : c.source === 'signed-pdf-text' ? `Signed PDF page ${c.page}: “${c.quote}” (found in the signed text)`
  : c.source === 'signed-pdf-page' ? `Signed PDF page ${c.page}: “${c.quote}”${unread(c)}` : `Executed text: “${c.quote}”${c.page ? ` (page ${c.page})` : ''}${unread(c)}`)

export function Terms({ state, a, locket }: { state: LocketState; a: Row; locket: Locket }) {
  const { run, busy } = locket
  const effective = ['executed', 'imported'].includes(a.status)
  const terms = state.terms.filter(t => t.agreement_id === a.id)
  const obligations = state.obligations.filter(o => o.agreement_id === a.id)
  const renewal = renewalOf(state, a.id)
  const confirmer = can(state, 'owner', 'counsel', 'approver')
  const people = state.operators.filter(o => o.status === 'active')
  if (!effective) return <Empty>Terms and obligations are confirmed against the executed agreement. This one is not executed yet.</Empty>
  return (
    <div className="lk-tab-page">
      <FamilyBlock state={state} a={a} />
      {a.type==='supplier'&&<AccountingAllocation state={state} a={a} locket={locket}/>}
      {a.type==='supplier'&&<AccountingSchedules state={state} a={a} locket={locket}/>}
      <RenewalHistory state={state} a={a} locket={locket} />
      {a.type==='supplier'&&<InvoiceReconciliation state={state} a={a} locket={locket} />}
      {a.type==='supplier'&&<ServiceLevels state={state} a={a} locket={locket} />}
      {a.type==='supplier'&&<ServicePerformance state={state} agreement={a} locket={locket} />}
      <section className="lk-panel">
        <div className="lk-panel-head"><h2>Terms</h2>{renewal && <span className="lk-muted">Notice deadline <span className="lk-nowrap">{deadline(renewal.deadline_at, renewal.timezone)}</span></span>}</div>
        <table className="lk-table">
          <thead><tr><th>Term</th><th>Value</th><th>Evidence</th><th>Status</th><th><span className="lk-visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {[...keys, ...state.customFields.map(f => `custom:${f.id}`)].flatMap(k => terms.filter(t => t.key === k).sort((x, y) => y.created_at - x.created_at)).map(t => (
              <tr key={t.id} className={['superseded', 'rejected'].includes(t.status) ? 'lk-faded' : undefined}>
                <td data-label="Term">{metadataTermLabel(state, t.key)}</td>
                <td data-label="Value">{metadataTermValue(state, t.key, t.value)}</td>
                <td data-label="Evidence" className="lk-evidence">{cite(parse(t.citation))}<small>{t.confirmed_by ? <>{t.status === 'rejected' ? 'Rejected' : 'Confirmed'} by {personName(state, t.confirmed_by)} <When at={t.confirmed_at} /></> : `Proposed by ${personName(state, t.proposed_by)}`}</small></td>
                <td data-label="Status"><Badge value={t.status} />{t.proposal_id && <small>agent proposal</small>}</td>
                <td>{t.status === 'proposed' && confirmer && <span className="lk-row-actions"><button type="button" className="lk-small lk-primary" disabled={busy} onClick={() => void run('term.decide', { agreementId: a.id, termId: t.id, decision: 'confirm' })}>Confirm</button><button type="button" className="lk-small" disabled={busy} onClick={() => void run('term.decide', { agreementId: a.id, termId: t.id, decision: 'reject', reason: window.prompt('Why reject this value?') ?? undefined })}>Reject</button></span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {terms.length === 0 && <Empty>No terms yet. Propose them with the clause they come from.</Empty>}
        {can(state, 'owner', 'counsel', 'approver', 'requester') && (
          <details className="lk-disclosure">
            <summary>Propose or correct a term</summary>
            <Form busy={busy} submit="Propose term" onSubmit={async (data, form) => {
              const page = value(data, 'page')
              if (await run('term.propose', { agreementId: a.id, key: value(data, 'key'), value: value(data, 'value'), reason: value(data, 'reason') || undefined, citation: { quote: value(data, 'quote'), page: page ? Number(page) : undefined } })) form.reset()
            }}>
              <Field label="Term"><select name="key">{keys.map(k => <option key={k} value={k}>{termLabel[k] ?? k.replaceAll('_',' ')}</option>)}</select></Field>
              <Field label="Value" hint="Dates as YYYY-MM-DD; renewal type: fixed, auto_renew, evergreen or optional; auto renew: yes or no; days, months and renewals allowed: whole numbers. Blank renewals allowed means unlimited."><input name="value" list="lk-governing-law" /></Field>
              <datalist id="lk-governing-law">{usJurisdictions.map(j => <option key={j} value={j} />)}</datalist>
              <Field label="Words from the signed clause"><textarea name="quote" rows={2} required /></Field>
              <Field label="Signed PDF page (needed when there is no text)"><input name="page" inputMode="numeric" /></Field>
              <Field label="Why (for corrections)"><input name="reason" /></Field>
            </Form>
          </details>
        )}
      </section>
      <section className="lk-panel">
        <div className="lk-panel-head"><h2>Obligations</h2></div>
        {obligations.length === 0 ? <Empty>No obligations recorded.</Empty> : (
          <ul className="lk-obligations">{obligations.map(o => (
            <li key={o.id}>
              <div className="lk-finding-head"><strong>{o.description}</strong><Badge value={o.status} /></div>
              <dl className="lk-obligation-facts">
                <div><dt>Owner</dt><dd><Person name={personName(state, o.owner_id)} /></dd></div>
                <div><dt>Due</dt><dd>{day(o.due_date)}</dd></div>
                <div><dt>Repeats</dt><dd>{o.recurrence === 'none' ? 'Once' : words(o.recurrence)}</dd></div>
                <div><dt>Risk</dt><dd><RiskLabel state={state} o={o} /></dd></div>
                <div><dt>Evidence</dt><dd>{evidenceLabel[o.evidence] ?? 'None required'}</dd></div>
              </dl>
              {o.status === 'done' && <ObligationEvidence state={state} o={o} />}
              <small>{cite(parse(o.citation))}</small>
              {o.status === 'confirmed' && o.due_date && <DeadlineReminderLog state={state} subjectId={o.id} />}
              <span className="lk-row-actions">
                {o.status === 'proposed' && confirmer && <><button type="button" className="lk-small lk-primary" disabled={busy} onClick={() => void run('obligation.update', { agreementId: a.id, obligationId: o.id, action: 'confirm' })}>Confirm</button><button type="button" className="lk-small" disabled={busy} onClick={() => void run('obligation.update', { agreementId: a.id, obligationId: o.id, action: 'reject' })}>Reject</button></>}
              </span>
              {['confirmed','done'].includes(o.status)&&<ObligationRemediation obligationId={o.id} ownerId={o.owner_id} actorId={state.actor.id} workspace={state.remediation} run={run} busy={busy} canConfigure={o.status==='confirmed'&&confirmer} canPrepare={o.status==='confirmed'&&can(state,'owner','counsel','approver','requester','agent')}/>}
              {o.status === 'confirmed' && !state.remediation.requirements.some(r=>r.obligation_id===o.id) && (o.owner_id === state.actor.id || confirmer) && <MarkDone a={a} o={o} locket={locket} />}
            </li>
          ))}</ul>
        )}
        {can(state, 'owner', 'counsel', 'approver', 'requester') && (
          <details className="lk-disclosure">
            <summary>Add an obligation</summary>
            <Form busy={busy} submit="Propose obligation" onSubmit={async (data, form) => {
              const page = value(data, 'page')
              if (await run('obligation.add', { agreementId: a.id, description: value(data, 'description'), ownerId: value(data, 'ownerId'), dueDate: value(data, 'dueDate') || undefined, evidence: value(data, 'evidence'), risk: value(data, 'risk'), recurrence: value(data, 'recurrence'), citation: { quote: value(data, 'quote'), page: page ? Number(page) : undefined } })) form.reset()
            }}>
              <Field label="What must be done"><input name="description" required /></Field>
              <Field label="Responsible person"><select name="ownerId">{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Field label="Due"><input type="date" name="dueDate" /></Field>
              <Field label="Repeats"><select name="recurrence"><option value="none">Once</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annually">Annually</option></select></Field>
              <Field label="Evidence needed to mark it done"><select name="evidence"><option value="none">None</option><option value="file">A file, such as a certificate of insurance</option><option value="link">A link</option><option value="note">A note</option></select></Field>
              <Field label="Risk rating" hint="Raised one level while the obligation is overdue."><select name="risk" defaultValue="medium"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></Field>
              <Field label="Words from the signed clause"><textarea name="quote" rows={2} required /></Field>
              <Field label="Signed PDF page (needed when there is no text)"><input name="page" inputMode="numeric" /></Field>
            </Form>
          </details>
        )}
      </section>
    </div>
  )
}

const evidenceLabel: Record<string, string> = { none: 'None required', file: 'A file is required', link: 'A link is required', note: 'A note is required' }

/** OBL-002: marking done carries the evidence the obligation requires (and any other given). */
function MarkDone({ a, o, locket }: { a: Row; o: Row; locket: Locket }) {
  return (
    <Form busy={locket.busy} submit="Mark done" onSubmit={async data => {
      const file = data.get('file') as File | null
      await locket.run('obligation.update', { agreementId: a.id, obligationId: o.id, action: 'done', ...(file?.size ? { file: await fileToPayload(file) } : {}), link: value(data, 'link') || undefined, note: value(data, 'note') || undefined })
    }}>
      {o.evidence === 'file' && <Field label="Evidence file"><input type="file" name="file" /></Field>}
      {o.evidence === 'link' && <Field label="Evidence link"><input name="link" type="url" placeholder="https://" /></Field>}
      {o.evidence === 'note' && <Field label="Evidence note"><textarea name="note" rows={2} /></Field>}
    </Form>
  )
}
function ObligationEvidence({ state, o }: { state: LocketState; o: Row }) {
  const f = state.artifacts.find(x => x.id === o.evidence_artifact_id)
  if (!f && !o.evidence_link && !o.evidence_note) return null
  return <p className="lk-muted">Evidence: {f && <a href={`/api/locket/files/${f.id}`} download>{f.filename}</a>}{o.evidence_link && <a href={o.evidence_link} rel="noreferrer noopener" target="_blank">{o.evidence_link}</a>}{o.evidence_note && <span>{o.evidence_note}</span>}</p>
}
