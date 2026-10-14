import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Badge, Empty, Field, Form, Person, value, When } from './controls'
import { can, day, deadline, parse, personName, renewalOf, termLabel, termValue, words } from './format'

const keys = ['effective_date', 'end_date', 'auto_renew', 'renewal_term_months', 'notice_days', 'governing_law', 'payment_terms']
const cite = (c: any) => (c.source === 'import-manifest' ? `Import manifest row ${c.row} (not yet checked against the signed PDF)` : c.source === 'signed-pdf-page' ? `Signed PDF page ${c.page}: “${c.quote}”` : `Executed text: “${c.quote}”${c.page ? ` (page ${c.page})` : ''}`)

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
    <div className="lk-columns">
      <section className="lk-panel">
        <div className="lk-panel-head"><h2>Terms</h2>{renewal && <span className="lk-muted">Notice deadline <span className="lk-nowrap">{deadline(renewal.deadline_at, renewal.timezone)}</span> ({renewal.timezone})</span>}</div>
        <table className="lk-table">
          <thead><tr><th>Term</th><th>Value</th><th>Evidence</th><th>Status</th><th><span className="lk-visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {keys.flatMap(k => terms.filter(t => t.key === k).sort((x, y) => y.created_at - x.created_at)).map(t => (
              <tr key={t.id} className={['superseded', 'rejected'].includes(t.status) ? 'lk-faded' : undefined}>
                <td data-label="Term">{termLabel[t.key]}</td>
                <td data-label="Value">{termValue(t.key, t.value)}</td>
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
              <Field label="Term"><select name="key">{keys.map(k => <option key={k} value={k}>{termLabel[k]}</option>)}</select></Field>
              <Field label="Value" hint="Dates as YYYY-MM-DD; auto renew as yes or no; days and months as whole numbers."><input name="value" required /></Field>
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
              </dl>
              <small>{cite(parse(o.citation))}</small>
              <span className="lk-row-actions">
                {o.status === 'proposed' && confirmer && <><button type="button" className="lk-small lk-primary" disabled={busy} onClick={() => void run('obligation.update', { agreementId: a.id, obligationId: o.id, action: 'confirm' })}>Confirm</button><button type="button" className="lk-small" disabled={busy} onClick={() => void run('obligation.update', { agreementId: a.id, obligationId: o.id, action: 'reject' })}>Reject</button></>}
                {o.status === 'confirmed' && (o.owner_id === state.actor.id || confirmer) && <button type="button" className="lk-small" disabled={busy} onClick={() => void run('obligation.update', { agreementId: a.id, obligationId: o.id, action: 'done' })}>Mark done</button>}
              </span>
            </li>
          ))}</ul>
        )}
        {can(state, 'owner', 'counsel', 'approver', 'requester') && (
          <details className="lk-disclosure">
            <summary>Add an obligation</summary>
            <Form busy={busy} submit="Propose obligation" onSubmit={async (data, form) => {
              const page = value(data, 'page')
              if (await run('obligation.add', { agreementId: a.id, description: value(data, 'description'), ownerId: value(data, 'ownerId'), dueDate: value(data, 'dueDate') || undefined, recurrence: value(data, 'recurrence'), citation: { quote: value(data, 'quote'), page: page ? Number(page) : undefined } })) form.reset()
            }}>
              <Field label="What must be done"><input name="description" required /></Field>
              <Field label="Responsible person"><select name="ownerId">{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Field label="Due"><input type="date" name="dueDate" /></Field>
              <Field label="Repeats"><select name="recurrence"><option value="none">Once</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annually">Annually</option></select></Field>
              <Field label="Words from the signed clause"><textarea name="quote" rows={2} required /></Field>
              <Field label="Signed PDF page (needed when there is no text)"><input name="page" inputMode="numeric" /></Field>
            </Form>
          </details>
        )}
      </section>
    </div>
  )
}
