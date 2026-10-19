import { useState } from 'react'
import { approvedClauses, clauseUses } from '../locket/clause-provenance'
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Empty, Field, Form, value } from './controls'
import { currentVersion } from './format'

const variantNames: Record<string, string> = { preferred: 'Preferred', fallback1: 'Fallback one', fallback2: 'Fallback two', 'walk-away': 'Walk-away', walkaway: 'Walk-away' }

export function ClauseLibrary({ state, agreement, locket, onInserted }: { state: LocketState; agreement?: Row; locket?: Locket; onInserted?: () => void }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const results = approvedClauses(state, query)
  const chosen = results.find(c => c.id === selected)
  const version = agreement ? currentVersion(state, agreement) : null
  return <section className="lk-panel" aria-label="Approved clause library">
    <div className="lk-panel-head"><h2>Approved clause library</h2></div>
    <Field label="Search clauses by topic"><input type="search" value={query} onChange={e => { setQuery(e.target.value); setSelected('') }} placeholder="e.g. indemnity" /></Field>
    <p className="lk-muted">An approved template version is the library version. Acceptance counts cover executed agreements you can access whose current signed version retains a selected or inserted wording.</p>
    {results.length === 0 ? <Empty>No matching approved clauses.</Empty> : <ul className="lk-rules">{results.map(c => <li key={c.id}>
      <strong>{c.clauseTitle} · {variantNames[c.variantId] ?? c.variantLabel}</strong>
      <small>{c.templateName} · library v{c.libraryVersionNumber} · {c.acceptanceCount} accepted</small>
      <p>{c.text}</p>
      <p className="lk-muted">Usage notes: {c.notes || 'No usage notes recorded.'}</p>
      {c.rule ? <details><summary>Playbook rule: {c.rule.title} ({c.ruleKey}) · v{c.playbookNumber}</summary><p>{c.rule.preferred}</p>{c.rule.alternatives.map((alternative: string, i: number) => <p key={i}>{alternative}</p>)}<p>{c.rule.guidance}</p><small>Exception authority: {c.rule.authority}</small></details> : <small>No active matching playbook rule ({c.ruleKey}).</small>}
      {version && <button type="button" className="lk-small" aria-pressed={selected === c.id} onClick={() => setSelected(c.id)}>Choose {variantNames[c.variantId] ?? c.variantLabel}</button>}
    </li>)}</ul>}
    {chosen && version && agreement && locket && <Form busy={locket.busy} submit="Insert clause into new version" onSubmit={async data => {
      const quote = value(data, 'quote'), body = version.text ?? ''
      const start = quote ? body.indexOf(quote) : body.length
      if (start < 0) return locket.setError('The selected passage is not in the current version.')
      if (quote && body.indexOf(quote, start + 1) >= 0) return locket.setError('Select a longer, unique passage to replace.')
      const result = await locket.run('clause.insert', { agreementId: agreement.id, version: agreement.version, versionId: version.id, libraryVersionId: chosen.libraryVersionId, clauseKey: chosen.clauseKey, variantId: chosen.variantId, start, end: start + quote.length, quote })
      if (result) { window.location.hash = `agreement/${agreement.id}/versions/${result.number}`; onInserted?.() }
    }}>
      <h3>Insert {chosen.variantLabel}</h3>
      <Field label="Passage to replace" hint="Paste a unique passage from the current version, or leave empty to append at the end."><textarea name="quote" rows={3} /></Field>
      <p className="lk-muted">Creates a new PDF version from the current text and this approved wording. Earlier originals stay available; the new version needs approval.</p>
    </Form>}
  </section>
}

export function ClauseProvenance({ version }: { version: Row }) {
  const uses = clauseUses(version.fields)
  if (!uses.length) return null
  return <details className="lk-disclosure" open><summary>Library wording in v{version.number}</summary><ul className="lk-rules">{uses.map((use, index) => <li key={index}>
    <strong>{use.clauseTitle} · {variantNames[use.variantId] ?? use.variantLabel}</strong>
    <p>{use.templateName} · library v{use.libraryVersionNumber} · {use.libraryVersionId}</p>
    <small>Rule: {use.ruleKey}{use.playbookVersionId ? ` · playbook ${use.playbookVersionId}` : ''}</small>
    <p>{use.text}</p>
  </li>)}</ul></details>
}
