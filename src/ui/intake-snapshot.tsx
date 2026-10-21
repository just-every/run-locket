import type { LocketState } from './api'
import { parse, personName, roleLabel } from './format'
export function IntakeSnapshot({state,id}:{state:LocketState;id:string}) {
  const form=state.requestForms.find(f=>f.agreement_id===id)
  if(!form) return null
  const route=parse<any>(form.route)
  return <section className="lk-panel" aria-label="Published request route">
    <div className="lk-panel-head"><h2>Request form and route</h2></div>
    <p>{form.form_name} · v{form.form_number} · {form.matched_rule ?? 'Default route'}</p>
    <dl className="lk-doc-meta"><div><dt>Responsible person</dt><dd>{personName(state,route.ownerId)}</dd></div><div><dt>Reviewer</dt><dd>{personName(state,route.reviewerId)}</dd></div><div><dt>Approval</dt><dd>{roleLabel[route.approvalRole]} or owner</dd></div></dl>
    <p className="lk-muted">This request keeps the form version and route it started with.</p>
  </section>
}
