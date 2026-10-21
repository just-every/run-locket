import type { LocketState } from './api'
import { money, parse, personName, roleLabel } from './format'
export function IntakeSnapshot({state,id}:{state:LocketState;id:string}) {
  const form=state.requestForms.find(f=>f.agreement_id===id)
  if(!form) return null
  const route=parse<any>(form.route),answers=parse<Record<string,any>>(form.answers)
  const fields=parse<import('./intake-form-fields').IntakeField[]>(form.form_fields)
  const shown=fields.filter(f=>answers[f.key]!==undefined)
  return <section className="lk-panel" aria-label="Published request route">
    <div className="lk-panel-head"><h2>Request form and route</h2></div>
    <p>{form.form_name} · v{form.form_number} · {form.matched_rule ?? 'Default route'}</p>
    <dl className="lk-doc-meta"><div><dt>Responsible person</dt><dd>{personName(state,route.ownerId)}</dd></div><div><dt>Reviewer</dt><dd>{personName(state,route.reviewerId)}</dd></div><div><dt>Approval</dt><dd>{roleLabel[route.approvalRole]} or owner</dd></div></dl>
    {(shown.length>0 || answers.region || answers.department) && <dl aria-label="Request answers" style={{overflowWrap:'anywhere'}}>
      {answers.department && <div><dt>Department</dt><dd>{state.intakeAudiences.find(a=>a.id===answers.department)?.name ?? 'Recorded department'}</dd></div>}
      {answers.region && <div><dt>Region</dt><dd>{answers.region}</dd></div>}
      {shown.map(f=><div key={f.key}><dt>{f.label}</dt><dd>{f.kind==='file' ? <a href={`/api/locket/files/${answers[f.key].artifactId}`} download>{answers[f.key].filename}</a> : f.kind==='person' ? personName(state,answers[f.key]) : f.kind==='counterparty' ? state.parties.find(p=>p.id===answers[f.key])?.name ?? 'Unavailable counterparty' : f.kind==='money' ? money(Math.round(Number(answers[f.key])*100)) : String(answers[f.key])}</dd></div>)}
    </dl>}
    <p className="lk-muted">This request keeps the form version and route it started with.</p>
  </section>
}
