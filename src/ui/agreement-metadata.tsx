import { useState } from 'react'
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { can, currentVersion } from './format'
import { CustomFieldInputs, changedCustomValues, customFieldsFor, mayEditField, readCustomValues, storedCustomValues } from './custom-field-values'

export function AgreementMetadata({ state, a, locket }: { state: LocketState; a: Row; locket: Locket }) {
  const fields = customFieldsFor(state, a.type)
  const values = storedCustomValues(state, a.id)
  const editable = fields.filter(field => mayEditField(state, field))
  if (!fields.length) return null
  return <section className="lk-panel" aria-label="Agreement custom metadata" style={{ marginTop: 18, minWidth: 0 }}>
    <div className="lk-panel-head"><h2>Custom metadata</h2></div>
    {editable.length ? <Form key={`${a.id}:${a.version}`} busy={locket.busy} submit="Save custom metadata" onSubmit={data => { const changes = changedCustomValues(data, editable, values); if (!Object.keys(changes).length) { locket.setNotice('No metadata changes to save.'); return }; void locket.run('field.values.set', { agreementId: a.id, expectedVersion: a.version, values: changes }) }}>
      <div className="lk-grid2"><CustomFieldInputs state={state} fields={fields} values={values} stage={a.status} /></div>
    </Form> : <div className="lk-grid2"><CustomFieldInputs state={state} fields={fields} values={values} editable={false} /></div>}
    {can(state, 'owner', 'counsel', 'approver', 'requester', 'agent') && currentVersion(state, a) && <PrepareMetadataProposal state={state} a={a} fields={fields} locket={locket} />}
  </section>
}
function PrepareMetadataProposal({ state, a, fields, locket }: { state: LocketState; a: Row; fields: Row[]; locket: Locket }) {
  const version = currentVersion(state, a)!
  const [quote, setQuote] = useState('')
  const [chosenStart, setChosenStart] = useState(0)
  const text: string = version.text ?? ''
  const occurrences: number[] = []
  if (quote) {
    let at = text.indexOf(quote)
    while (at >= 0) { occurrences.push(at); at = text.indexOf(quote, at + 1) }
  }
  const start = occurrences.includes(chosenStart) ? chosenStart : occurrences[0]
  return <details className="lk-disclosure"><summary>Prepare a cited metadata proposal</summary>
    <p className="lk-muted">Proposed values take effect only after a person with field-edit authority accepts them. The citation refers to the current document version.</p>
    <Form key={version.id} busy={locket.busy} submit="Prepare metadata proposal" onSubmit={async (data, form) => {
      if (start === undefined || text.slice(start, start + quote.length) !== quote) { locket.setError('Choose an exact passage from the current document.'); return }
      const values = readCustomValues(data, fields)
      const proposed = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null))
      if (!Object.keys(proposed).length) { locket.setError('Enter at least one proposed metadata value.'); return }
      if (await locket.run('proposal.prepare', { kind: 'custom_fields', payload: { agreementId: a.id, versionId: version.id, values: proposed, citation: { quote, start, end: start + quote.length } }, evidence: [quote], assumptions: value(data, 'assumptions') })) { setQuote(''); setChosenStart(0); form.reset() }
    }}>
      <div className="lk-grid2"><CustomFieldInputs state={state} fields={fields} stored={false} editable proposal /></div>
      <Field label="Exact words from the current document"><textarea name="quote" rows={3} required value={quote} onChange={event => { setQuote(event.target.value); setChosenStart(0) }} /></Field>
      {quote && !occurrences.length && <p role="status">This quote does not match the current document.</p>}
      {occurrences.length > 1 && <Field label="Choose the cited passage"><select value={start} onChange={event => setChosenStart(Number(event.target.value))}>{occurrences.map((at, index) => <option key={at} value={at}>{index + 1}: …{text.slice(Math.max(0, at - 40), at + quote.length + 40)}…</option>)}</select></Field>}
      {start !== undefined && <a href={`#agreement/${a.id}/versions/${version.number}/${start}/${start + quote.length}`}>Review cited passage in v{version.number}</a>}
      <Field label="Assumptions or questions"><textarea name="assumptions" rows={2} /></Field>
    </Form>
  </details>
}
