// ENTITY-001: the business's own contracting entities. The owner records them;
// everyone else reads who contracts, from where and who signs.
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Empty, Field, Form, value } from './controls'
import { can, parse } from './format'

export const entityName = (state: LocketState, id: string | null | undefined) => state.entities.find(e => e.id === id)?.legal_name ?? 'Not recorded'
export const signatories = (e: Row) => parse<{ name: string; email: string; title: string }[]>(e.signatories)

/** "Name | email | Title" per line. */
const signatoriesFrom = (text: string) => text.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [name, email, title] = l.split('|').map(s => s.trim()); return { name, email, title } })

export function EntitySelect({ state, name = 'entityId', value: selected, onChange }: { state: LocketState; name?: string; value?: string; onChange?: (id: string) => void }) {
  return (
    <Field label="Our contracting entity *" hint="Which of our legal entities signs this agreement.">
      <select name={name} required value={selected} onChange={e => onChange?.(e.target.value)}>
        {state.entities.map(e => <option key={e.id} value={e.id}>{e.legal_name}</option>)}
      </select>
    </Field>
  )
}

export function OurEntities({ state, locket }: { state: LocketState; locket: Locket }) {
  const { run, busy } = locket
  return (
    <section className="lk-panel" aria-labelledby="lk-entities">
      <div className="lk-panel-head"><h2 id="lk-entities">Our entities</h2></div>
      {state.entities.length === 0 ? <Empty>No contracting entities recorded. Once one is, every new agreement names which entity contracts.</Empty> : (
        <ul className="lk-rules">{state.entities.map(e => (
          <li key={e.id}>
            <strong>{e.legal_name}</strong>
            <p>{e.entity_type} · formed in {e.formation}{e.tax_id ? ` · ${e.tax_id_kind === 'ein' ? 'EIN' : 'Tax ID'} ${e.tax_id}` : ''} · {e.currency} · {e.timezone}</p>
            <small>Notice address: {e.notice_address}</small>
            <small>Registered address: {e.registered_address}</small>
            <small>Signatories: {signatories(e).map(s => `${s.name} (${s.title})`).join(', ') || 'none recorded'}</small>
          </li>
        ))}</ul>
      )}
      {can(state, 'owner') && (
        <details className="lk-disclosure">
          <summary>Record an entity</summary>
          <Form busy={busy} submit="Save entity" onSubmit={async (data, form) => {
            const taxIdKind = value(data, 'taxIdKind')
            const saved = await run('entity.save', {
              legalName: value(data, 'legalName'), entityType: value(data, 'entityType'), formation: value(data, 'formation'),
              ...(taxIdKind ? { taxIdKind, taxId: value(data, 'taxId') } : {}),
              registeredAddress: value(data, 'registeredAddress'), noticeAddress: value(data, 'noticeAddress'),
              currency: value(data, 'currency'), timezone: value(data, 'timezone'), signatories: signatoriesFrom(value(data, 'signatories')),
            })
            if (saved) form.reset()
          }}>
            <div className="lk-grid2">
              <Field label="Legal name *"><input name="legalName" required /></Field>
              <Field label="Entity type *" hint="e.g. Corporation, Private limited company"><input name="entityType" required /></Field>
              <Field label="State or country of formation *"><input name="formation" required /></Field>
              <Field label="Tax ID kind"><select name="taxIdKind"><option value="">None recorded</option><option value="ein">EIN</option><option value="foreign">Foreign tax ID</option></select></Field>
              <Field label="Tax ID" hint="EIN as 12-3456789"><input name="taxId" /></Field>
              <Field label="Default currency *"><input name="currency" defaultValue="USD" maxLength={3} required /></Field>
              <Field label="Time zone *"><input name="timezone" defaultValue="America/New_York" required /></Field>
            </div>
            <Field label="Registered address *"><textarea name="registeredAddress" rows={2} required /></Field>
            <Field label="Notice address *" hint="Printed on notices sent for this entity."><textarea name="noticeAddress" rows={2} required /></Field>
            <Field label="Authorized signatories" hint="One per line: Name | email | Title"><textarea name="signatories" rows={2} /></Field>
          </Form>
        </details>
      )}
    </section>
  )
}

/** Owner or counsel names or corrects the contracting entity on one agreement. */
export function AssignEntity({ state, a, locket }: { state: LocketState; a: Row; locket: Locket }) {
  if (!state.entities.length || !can(state, 'owner', 'counsel') || ['out_for_signature', 'cancelled'].includes(a.status)) return null
  return (
    <Form busy={locket.busy} submit="Set entity" className="lk-inline" onSubmit={data => void locket.run('agreement.entity', { agreementId: a.id, version: a.version, entityId: value(data, 'entityId') })}>
      <select name="entityId" aria-label="Contracting entity" defaultValue={a.entity_id ?? state.entities[0].id}>{state.entities.map(e => <option key={e.id} value={e.id}>{e.legal_name}</option>)}</select>
    </Form>
  )
}
