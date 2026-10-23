import { useState, type FormEvent } from 'react'
import type { Row, Run } from './api'
import './style/remediation.css'

export interface RemediationWorkspace {requirements:Row[];requests:Row[];occurrences:Row[];evidence:Row[]}
export interface ObligationRemediationProps {
 obligationId:string;ownerId:string;actorId:string;workspace:RemediationWorkspace;run:Run;busy?:boolean;canConfigure:boolean;canPrepare?:boolean
}
const value=(form:HTMLFormElement,key:string)=>String(new FormData(form).get(key)??'')
const fieldLabel:Record<string,string>={coverageCents:'Coverage (USD)',insured:'Named insured',validFrom:'Coverage begins',validThrough:'Coverage ends',original:'Original certificate review',document:'Original document review'}
async function pdfInput(file:File){const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return {filename:file.name,mediaType:file.type,base64:btoa(binary)}}
export function ObligationRemediation({obligationId,ownerId,actorId,workspace,run,busy,canConfigure,canPrepare=true}:ObligationRemediationProps){
 const [error,setError]=useState('')
 const [automaticDraft,setAutomaticDraft]=useState(true)
 const requirement=workspace.requirements.find(r=>r.obligation_id===obligationId&&r.active===1)
 const requests=workspace.requests.filter(r=>r.requirement_id===requirement?.id)
 const evidence=workspace.evidence.filter(e=>e.requirement_id===requirement?.id)
 const submit=(action:(form:HTMLFormElement)=>Promise<unknown>)=>(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const form=event.currentTarget;setError('');void action(form).catch(e=>setError(e instanceof Error?e.message:String(e)))}
 return <section aria-label="Obligation remediation" className="lk-remediation">
  <h3>Remediation</h3>
  <p>The obligation owner approves each exact request and chase time. Each occurrence is attempted once; provider acceptance does not confirm delivery. A person reviews any unverified evidence. Remediation never waives a requirement.</p>
  {error&&<p role="alert">{error}</p>}
  {canConfigure&&<details><summary>{requirement?'Replace the confirmed requirement':'Confirm evidence requirements'}</summary><form onSubmit={submit(async form=>run('remediation.configure',{obligationId,kind:value(form,'kind'),requirement:value(form,'kind')==='coi'?{coverageCents:Math.round(Number(value(form,'coverage'))*100),insured:value(form,'insured'),validFrom:value(form,'validFrom'),validThrough:value(form,'validThrough')}:{description:value(form,'description')},citation:{quote:value(form,'quote'),...(value(form,'page')?{page:Number(value(form,'page'))}:{})}}))}>
   <label>Evidence type<select name="kind"><option value="coi">Certificate of insurance</option><option value="document">Other document</option></select></label>
   <label>Required coverage (USD)<input name="coverage" type="number" min="0.01" step="0.01" /></label>
   <label>Required named insured<input name="insured" /></label>
   <label>Coverage required from<input name="validFrom" type="date" /></label>
   <label>Coverage required through<input name="validThrough" type="date" /></label>
   <label>Other document requirement<textarea name="description" /></label>
   <label>Words from the signed clause<textarea name="quote" required /></label>
   <label>Signed PDF page<input name="page" type="number" min="1" /></label>
   <button disabled={busy}>Confirm requirement</button>
  </form></details>}
  {requirement&&<>
   <p>{requirement.kind==='coi'?(()=>{const r=JSON.parse(requirement.requirement);return `Required: USD ${(r.coverageCents/100).toFixed(2)}, ${r.insured}, ${r.validFrom} through ${r.validThrough}.`})():JSON.parse(requirement.requirement).description}</p>
   {canPrepare&&<details><summary>Prepare request and chase schedule</summary><form onSubmit={submit(async form=>{
    const times=value(form,'times').split('\n').map(s=>s.trim()).filter(Boolean)
    await run('remediation.prepare',{requirementId:requirement.id,target:value(form,'target'),recipient:value(form,'recipient'),draftFromRequirement:automaticDraft,occurrences:times.map(time=>({sendAt:Date.parse(time+'Z'),subject:value(form,'subject'),message:value(form,'message')}))})
   })}>
    <label>Responsible party<select name="target"><option value="supplier">Supplier contact</option><option value="internal">Internal obligation owner</option></select></label>
    <label>Recorded supplier contact email<input name="recipient" type="email" /></label>
    <label><input type="checkbox" checked={automaticDraft} onChange={event=>setAutomaticDraft(event.target.checked)}/> Draft requests from the confirmed requirement</label>
    {!automaticDraft&&<><label>Subject<input name="subject" required /></label>
    <label>Exact request and chase message<textarea name="message" required /></label></>}
    <label>Send times in UTC, one per line (YYYY-MM-DDTHH:mm)<textarea name="times" required /></label>
    <p>The obligation owner reviews each exact message and every send time before approval.</p>
    <button disabled={busy}>Prepare requests</button>
   </form></details>}
   {requests.map(request=><article key={request.id}><h4>Request to {request.recipient}</h4><p>Status: {request.status}</p>
    {workspace.occurrences.filter(o=>o.request_id===request.id).map(o=><div key={o.id}><p>{new Date(o.send_at).toISOString()} — {o.status}</p><strong>{o.subject}</strong><p style={{whiteSpace:'pre-wrap'}}>{o.message_text}</p>{o.outcome_code&&<p>{o.outcome_code}</p>}
     {canPrepare&&actorId===ownerId&&request.status==='approved'&&o.status==='pending'&&<button type="button" disabled={busy} onClick={()=>void run('remediation.send',{requestId:request.id,occurrenceId:o.id,digest:request.digest,consent:true})}>Send approved occurrence now</button>}
    </div>)}
    {canPrepare&&actorId===ownerId&&request.status==='draft'&&<button type="button" disabled={busy} onClick={()=>void run('remediation.approve',{requestId:request.id,digest:request.digest,consent:true})}>Approve every exact request and chase time</button>}
    {canPrepare&&actorId===ownerId&&['draft','approved'].includes(request.status)&&<form onSubmit={submit(async form=>run('remediation.cancel',{requestId:request.id,reason:value(form,'reason')}))}><label>Reason to withdraw future requests<input name="reason" required/></label><button disabled={busy}>Withdraw chase schedule</button></form>}
   </article>)}
   {canPrepare&&<form onSubmit={submit(async form=>{const file=new FormData(form).get('file');if(!(file instanceof File)||!file.size)throw new Error('Choose the returned original PDF.');await run('remediation.evidence',{requirementId:requirement.id,file:await pdfInput(file)})})}><label>Returned evidence PDF<input name="file" type="file" accept="application/pdf" required /></label><button disabled={busy}>Check evidence</button></form>}
   {evidence.map(proof=>{const assessment=JSON.parse(proof.assessment);return <article key={proof.id}><h4>Evidence: {proof.status}</h4><a href={`/api/locket/files/${proof.artifact_id}`}>Original evidence PDF</a>
    {Object.entries(assessment.fields).map(([key,raw])=>{const field=raw as any;return <p key={key}>{fieldLabel[key]??key}: {field.value===null?'Unknown':key==='coverageCents'?(field.value/100).toFixed(2):field.value} — {field.reason}{field.page&&<> Page {field.page}: “{field.quote}”</>}</p>})}
    {proof.status==='needs_confirmation'&&(actorId===ownerId||canConfigure)&&<form onSubmit={submit(async form=>{const values:Record<string,unknown>={};for(const [key,raw]of Object.entries(assessment.fields)){if((raw as any).status!=='unknown')continue;values[key]=key==='coverageCents'?Math.round(Number(value(form,key))*100):['document','original'].includes(key)?value(form,key)==='on':value(form,key)}await run('remediation.confirm',{evidenceId:proof.id,values,reason:value(form,'reason')})})}>
     {Object.entries(assessment.fields).filter(([,raw])=>(raw as any).status==='unknown').map(([key])=><label key={key}>{key==='coverageCents'?'Coverage seen in original (USD)':key==='document'?'I confirm the original satisfies the exact requirement':key==='original'?'I reviewed the original certificate, its issuer and conditions':fieldLabel[key]??key}<input name={key} required type={['document','original'].includes(key)?'checkbox':key==='coverageCents'?'number':key.startsWith('valid')?'date':'text'} step={key==='coverageCents'?'0.01':undefined} /></label>)}
     <label>Review reason and original page references<textarea name="reason" required /></label><button disabled={busy}>Confirm unknown fields and complete</button>
    </form>}
   </article>})}
  </>}
 </section>
}
