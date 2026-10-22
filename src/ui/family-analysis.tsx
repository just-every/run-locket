import { noticeDeadlineFor } from '../locket/business-days'
import { lifecycle } from '../locket/lifecycle'
import type { AnalysisConflict } from '../locket/family-analysis-model'
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { can, day, deadline, parse, personName, words } from './format'

export function FamilyAnalysis({state,root,locket}:{state:LocketState;root:Row;locket:Locket}) {
 const analyses=state.familyAnalyses.filter(a=>a.root_id===root.id)
 const latest=analyses[0],blocked=state.familyBlocks.includes(root.id)
 const conflicts=latest?parse<AnalysisConflict[]>(latest.conflicts):[]
 const current=lifecycle(root,state.terms,state.renewals,state.notices,state.now,state.settings.rollNoticeDeadlines)
 const preparer=can(state,'owner','counsel'),counsel=can(state,'counsel'),runner=can(state,'owner')
 return <section className="lk-panel" aria-label="Governing family analysis">
  <div className="lk-panel-head"><h2>Governing family analysis</h2></div>
  <p>Compare executed text and confirmed terms. Counsel confirms precedence, effective terms and exactly which parent obligations use them.</p>
  {blocked&&<p role="status"><strong>Derived actions blocked.</strong> Renewal decisions, notices and obligation completion wait for counsel’s current resolution. <a href={`#agreement/${root.id}/family`}>Review this family</a>.</p>}
  {!latest&&<p>No executed-text analysis has been prepared.</p>}
  {preparer&&!state.familyModel?.enabled&&<p>Family analysis is off. The owner must configure and enable a model connection first.</p>}
  {preparer&&state.familyModel?.enabled&&<p>Configured model: {state.familyModel.model} at {state.familyModel.endpoint}.</p>}
  {latest?.stale&&<p role="alert">Source family changed. Prepare a new analysis; previous choices no longer authorize derived actions.</p>}
  {preparer&&(!latest||latest.stale||latest.status==='resolved')&&<button type="button" disabled={locket.busy||!state.familyModel?.enabled} onClick={()=>void locket.run('family.analysis.prepare',{agreementId:root.id})}>Prepare executed-family analysis</button>}
  {latest&&<>
   <p>Analysis {latest.revision} · {words(latest.status)} · prepared by {personName(state,latest.prepared_by)}</p>
   <details><summary>Exact source snapshot</summary>{parse<any[]>(latest.sources).map(s=><article key={s.agreementId}>
    <h3><a href={`#agreement/${s.agreementId}/document`}>{s.title}</a></h3>
    {s.pages.map((p:any,i:number)=><blockquote key={i}>{p.page?`Page ${p.page}: `:''}{p.text}</blockquote>)}
   </article>)}</details>
   {latest.status==='prepared'&&!latest.stale&&runner&&<Form busy={locket.busy} submit="Analyze approved snapshot" onSubmit={data=>void locket.run('family.analysis.run',{analysisId:latest.id,sourceDigest:latest.source_digest,consent:data.has('consent')})}>
    <p>The configured model receives only these executed texts and confirmed terms. Its interpretations remain proposals. One request; no automatic provider retry.</p>
    <Field label="I authorize this exact family snapshot to the configured model"><input type="checkbox" name="consent" required/></Field>
   </Form>}
   {latest.status==='prepared'&&!latest.stale&&!runner&&<p>The owner must authorize sending this exact source snapshot to the configured model.</p>}
   {conflicts.map(conflict=><article key={conflict.key} className="lk-family-term">
    <h3>{words(conflict.key)}</h3><p>{conflict.summary}</p>
    {conflict.candidates.map((candidate,i)=>{
     const source=state.agreements.find(a=>a.id===candidate.agreementId)
     const notice=conflict.key==='notice_days'&&current.end?noticeDeadlineFor(current.end,Number(candidate.value),root.timezone,state.settings.rollNoticeDeadlines):null
     return <div key={i}><p><strong>{candidate.value}{conflict.key==='notice_days'?' days':''}</strong> · <a href={`#agreement/${candidate.agreementId}/terms`}>{source?.reference} · {source?.title}</a></p><blockquote>{candidate.quote}{candidate.page?` (page ${candidate.page})`:''}</blockquote>{notice&&<p>Candidate notice deadline: <time dateTime={new Date(notice.at).toISOString()}>{deadline(notice.at,root.timezone)}</time> · term ends {day(current.end)}. Candidate only until counsel confirms.</p>}</div>
    })}
    <p>Proposed choice: {conflict.candidates[conflict.recommended].value}. {conflict.reasoning}</p>
   </article>)}
   {latest.status==='pending'&&!latest.stale&&counsel&&<Form busy={locket.busy} submit="Confirm governing choices" onSubmit={data=>{
    const obligations=state.obligations.filter(o=>o.agreement_id===root.id&&['proposed','confirmed'].includes(o.status)).flatMap(o=>{
     const key=value(data,`obligation-${o.id}`)
     return key?[{obligationId:o.id,key,offsetDays:Number(value(data,`offset-${o.id}`)||0)}]:[]
    })
    void locket.run('family.analysis.resolve',{analysisId:latest.id,scopeAgreementId:root.id,choices:conflicts.map(c=>({key:c.key,candidate:Number(value(data,`choice-${c.key}`))})),reason:value(data,'reason'),obligations})
   }}>
    {conflicts.map(c=><Field key={c.key} label={`Governing ${words(c.key).toLowerCase()}`}><select name={`choice-${c.key}`} defaultValue="" required><option value="" disabled>Choose after reviewing precedence</option>{c.candidates.map((candidate,i)=><option key={i} value={i}>{candidate.value} · {state.agreements.find(a=>a.id===candidate.agreementId)?.title}</option>)}</select></Field>)}
    <p>Operational scope: {root.title}. Chosen date, notice and payment terms replace this parent’s confirmed values. Its renewal decision is withdrawn when dates move. Other family documents keep their own terms. Choose any parent obligations whose due dates must follow a selected date.</p>
    {state.obligations.filter(o=>o.agreement_id===root.id&&['proposed','confirmed'].includes(o.status)).map(o=><div key={o.id}>
     <Field label={`Derived date for ${o.description}`}><select name={`obligation-${o.id}`}><option value="">Keep recorded due date</option>{conflicts.filter(c=>['notice_days','end_date','effective_date'].includes(c.key)).map(c=><option key={c.key} value={c.key}>{c.key==='notice_days'?'Notice deadline':words(c.key)}</option>)}</select></Field>
     <Field label={`Day offset for ${o.description}`}><input name={`offset-${o.id}`} type="number" min="-730" max="730" defaultValue="0"/></Field>
    </div>)}
    <Field label="Precedence, effective terms and reason"><textarea name="reason" required rows={3}/></Field>
   </Form>}
   {latest.status==='pending'&&!counsel&&<p>Counsel must confirm these exact choices before derived actions can continue.</p>}
   {latest.status==='resolved'&&<><p>Confirmed by {personName(state,latest.resolved_by)}. {latest.reason}</p><ul>{parse<any>(latest.choices).terms.map((choice:any)=><li key={choice.key}>Governing {words(choice.key).toLowerCase()}: <strong>{choice.candidate.value}</strong> · <a href={`#agreement/${choice.candidate.agreementId}/terms`}>Executed source</a></li>)}</ul>{parse<any>(latest.choices).obligations.map((o:any)=><p key={o.obligationId}>{state.obligations.find(row=>row.id===o.obligationId)?.description}: due {day(o.dueDate)}</p>)}</>}
  </>}
 </section>
}
export function FamilyBlock({state,a}:{state:LocketState;a:Row}) {
 if(!state.familyBlocks.includes(a.id))return null
 return <p role="status"><strong>Derived actions blocked by family review.</strong> <a href={`#agreement/${a.id}/family`}>Counsel must resolve the current governing terms</a> before acting on these dates.</p>
}
