import { useEffect, useState } from 'react'
import { fetchJson } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { PacketApprovalDetails } from './signature-approval-summary'

interface Review {
 request:{id:string;versionId:string;versionDigest:string;contextDigest:string;source:string}
 agreement:{id:string;title:string;status:string}
 version:{id:string;number:number;digest:string;text:string|null}
 context:{valueCents:number|null;signaturePacket?:any}
 files:{id:string;filename:string}[]
 findings:{id:string;clause_key:string;result:string;explanation:string;quote:string}[]
 label:string;current:boolean;canDecide:boolean;currentReviewUrl:string
}
export function ApprovalChannelReview({id,locket}:{id:string;locket:Locket}){
 const [review,setReview]=useState<Review|null>(null),[error,setError]=useState(''),[saved,setSaved]=useState(false)
 const load=async()=>{try{setReview(await fetchJson<Review>('/api/locket/approval-channels/requests/'+encodeURIComponent(id)));setError('')}catch(cause){setError((cause as Error).message)}}
 useEffect(()=>{setReview(null);setSaved(false);void load()},[id])
 return <section className="lk-panel" aria-label="Authenticated approval request" style={{minWidth:0,overflowWrap:'anywhere'}}>
  <h1>Review approval request</h1>{error&&<p role="alert">{error}</p>}
  {!review&&!error&&<p>Loading your authenticated approval request…</p>}
  {review&&<>
   <h2>{review.agreement.title}</h2><p>{review.label} · Current version {review.version.number}</p>
   {!review.current&&<p role="alert">This request’s version or decision context has changed. The current version is shown below. Open its review and request a new approval before deciding.</p>}
   <p><a href={review.currentReviewUrl}>Open current agreement review</a></p>
   <p>Current version digest: <span style={{wordBreak:'break-all'}}>{review.version.digest}</span></p>
   {review.context.valueCents!==null&&<p>Agreement value: {new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(review.context.valueCents/100)}</p>}
   {review.version.text!==null?<div style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:420,overflowY:'auto'}} aria-label="Exact stored version text">{review.version.text}</div>:<p>Read the stored document before deciding.</p>}
   <ul>{review.files.map(f=><li key={f.id}><a href={`/api/locket/files/${f.id}`} download>{f.filename}</a></li>)}</ul>
   <PacketApprovalDetails packet={review.context.signaturePacket}/>
   {review.findings.length>0&&<section aria-label="Approval review findings"><h3>Review findings</h3>{review.findings.map(f=><div key={f.id}><strong>{f.clause_key} · {f.result}</strong><blockquote>{f.quote}</blockquote><p>{f.explanation}</p></div>)}</section>}
   {!saved&&review.canDecide&&<Form busy={locket.busy} submit="Record channel decision" onSubmit={async data=>{
    const result=await locket.run('approval.channel.decide',{requestId:id,versionId:review.request.versionId,versionDigest:review.request.versionDigest,contextDigest:review.request.contextDigest,decision:value(data,'decision'),reason:value(data,'reason')})
    if(result){setSaved(true);locket.setNotice('Decision recorded against the exact version digest under your current Locket identity.')}else await load()
   }}>
    <Field label="Approval decision"><select name="decision"><option value="approved">Approve</option><option value="rejected">Decline</option></select></Field>
    <Field label="Decision reason"><textarea name="reason" maxLength={2000}/></Field>
    <Field label="I reviewed this exact stored version and its approval context"><input type="checkbox" required/></Field>
   </Form>}
   {!saved&&review.current&&!review.canDecide&&<p>This approval is already decided, or your current authority does not permit this step.</p>}
   <button type="button" onClick={()=>void load()}>Reload approval request</button>
  </>}
 </section>
}
