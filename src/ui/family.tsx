import { family } from '../locket/family-projection'
import { relations } from '../locket/family-relations'
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { can, day, parse, termLabel, termValue, words } from './format'

export function Family({ state, a, locket }: { state: LocketState; a: Row; locket: Locket }) {
  const f = family(state, a.id)
  const edit = can(state, 'owner', 'counsel')
  return <div className="lk-tab-page lk-family">
    <section className="lk-panel">
      <div className="lk-panel-head"><h2>Agreement family</h2></div>
      <p>Parent: <a href={`#agreement/${f.root.id}/family`}>{f.root.reference} · {f.root.title}</a></p>
      <p className="lk-muted">Documents you can access, in ascending start-date order (creation date when no start date is recorded).</p>
      <ol className="lk-list">{f.members.map(m => <li key={m.id} data-family-member={m.id}>
        <div><a href={`#agreement/${m.id}/family`}>{m.reference} · {m.title}</a><p>{m.id === f.root.id ? 'Parent agreement' : words(m.relation ?? '')} · {day(m.start_date ?? new Date(m.created_at).toISOString().slice(0, 10))}</p></div>
      </li>)}</ol>
    </section>
    <section className="lk-panel">
      <div className="lk-panel-head"><h2>Governing key terms</h2></div>
      <p className="lk-muted">Owner or counsel records which confirmed term governs. This does not decide legal precedence or change renewal deadlines.</p>
      {!f.governing.length && <p>No governing terms selected.</p>}
      {f.governing.map(g => {
        const citation = parse<any>(g.term.citation)
        return <article key={g.key} className="lk-family-term" data-governing-key={g.key}>
          <h3>{termLabel[g.key] ?? words(g.key)}: {termValue(g.key, g.term.value)}</h3>
          {g.stale && <p role="status">Source changed — review and select a currently confirmed term.</p>}
          <p><a href={`#agreement/${g.source.id}/terms`}>{g.source.reference} · {g.source.title}</a></p>
          <blockquote>{citation.quote}{citation.page ? ` (page ${citation.page})` : ''}</blockquote>
        </article>
      })}
      {edit && f.candidates.length > 0 && <Form busy={locket.busy} submit="Select governing term" onSubmit={data => void locket.run('family.term', { agreementId: f.root.id, version: f.root.version, termId: value(data, 'termId') })}>
        <Field label="Confirmed source term"><select name="termId">{f.candidates.map(t => {
          const source = f.members.find(m => m.id === t.agreement_id)!
          return <option key={t.id} value={t.id}>{termLabel[t.key] ?? words(t.key)} · {termValue(t.key, t.value)} · {source.reference} {source.title}</option>
        })}</select></Field>
      </Form>}
    </section>
    {edit && <section className="lk-panel">
      <div className="lk-panel-head"><h2>Link this agreement</h2></div>
      <Form busy={locket.busy} submit="Save family link" onSubmit={data => {
        const parent = state.agreements.find(x => x.id === value(data, 'parentId'))!
        void locket.run('family.link', { agreementId: a.id, version: a.version, parentId: parent.id, parentVersion: parent.version, relation: value(data, 'relation') })
      }}>
        <Field label="Parent document"><select name="parentId" required defaultValue={a.parent_id ?? ''}><option value="" disabled>Choose an agreement</option>{state.agreements.filter(x => x.id !== a.id).map(x => <option key={x.id} value={x.id}>{x.reference} · {x.title}</option>)}</select></Field>
        <Field label="Relation"><select name="relation" defaultValue={a.relation ?? 'amends'}>{relations.map(r => <option key={r} value={r}>{words(r)}</option>)}</select></Field>
      </Form>
    </section>}
  </div>
}
