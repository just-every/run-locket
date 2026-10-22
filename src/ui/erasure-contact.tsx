import { useState } from 'react'
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { can, parse, words } from './format'
import { DraftFiles, PreviewRecords, RetainedRecords, type DraftChoice, type ErasurePreview, type ErasureResult } from './erasure-records'

export function EraseContact({state,party,locket}:{state:LocketState;party:Row;locket:Locket}){
 const [review,setReview]=useState<{email:string;preview:ErasurePreview}|null>(null)
 const [result,setResult]=useState<ErasureResult|null>(null)
 const contacts=parse<{name:string;email:string}[]>(party.contacts??'[]').filter(c=>!c.email.endsWith('@invalid.example'))
 if(!can(state,'owner')||!contacts.length&&!review&&!result)return null
 const today=new Date(state.now).toISOString().slice(0,10)
 return <section className="lk-panel" aria-label="Verified personal-data erasure" style={{minWidth:0,overflowWrap:'anywhere'}}>
  <h2>Verified personal-data erasure</h2>
  {!review&&!result&&<><p>Record a verified request, then review exactly which contacts, comments, notices and notification addresses will change. Held records, executed documents, signature evidence and audit history are retained. Review a separate disposition for each unexecuted draft.</p>
   <Form busy={locket.busy} submit="Preview erasure" onSubmit={async data=>{
    const email=value(data,'email')
    const preview=await locket.run('person.erase.preview',{email,verified:data.get('verified')==='on',method:value(data,'method'),receivedOn:value(data,'receivedOn'),reason:value(data,'reason')})
    if(preview)setReview({email,preview})
   }}>
    <Field label="Contact to erase"><select name="email" required>{contacts.map(c=><option key={c.email} value={c.email}>{c.name} · {c.email}</option>)}</select></Field>
    <Field label="How the request was verified"><select name="method" defaultValue="" required><option value="" disabled>Select a verification method</option><option value="established_channel">Established contact channel</option><option value="in_person">In person</option><option value="verified_letter">Verified letter</option></select></Field>
    <Field label="Request received on"><input name="receivedOn" type="date" max={today} defaultValue={today} required/></Field>
    <Field label="Erasure reason"><select name="reason" defaultValue="" required><option value="" disabled>Select a reason</option><option value="privacy_request">Privacy request</option><option value="legal_request">Legal request</option><option value="other_verified_request">Other verified request</option></select></Field>
    <label className="lk-check"><input type="checkbox" name="verified" required/>I verified this person’s erasure request.</label>
   </Form>
  </>}
  {review&&<div aria-label="Erasure preview">
   <h3>Erasure preview</h3><p>Nothing has been erased. Confirm this exact preview after reviewing every record and draft below. Changes to the underlying records require a new preview.</p>
   <p>Preview fingerprint: <span className="lk-mono">{review.preview.fingerprint}</span></p>
   <PreviewRecords state={state} patches={review.preview.patches}/>
   <RetainedRecords state={state} records={review.preview.retained}/>
   <h3>Unexecuted drafts</h3>
   <Form key={review.preview.id} busy={locket.busy} submit="Confirm previewed erasure" onSubmit={async data=>{
    const draftDispositions:DraftChoice[]=review.preview.drafts.map(d=>{
     const choice=value(data,`draft:${d.id}`)
     return {agreementId:d.id,action:choice==='delete'?'delete':'retain',reason:choice==='delete'?'request_scope':choice as DraftChoice['reason']}
    })
    const outcome=await locket.run('person.erase',{previewId:review.preview.id,fingerprint:review.preview.fingerprint,email:review.email,draftDispositions})
    if(outcome){setResult(outcome);setReview(null)}
   }}>
    {review.preview.drafts.length?review.preview.drafts.map(d=>{
     const title=state.agreements.find(a=>a.id===d.id)?.title??d.id
     return <fieldset className="lk-fieldset" key={d.id} style={{minWidth:0}}><legend>{title}</legend><p>Agreement: {d.id} · Revision {d.version}{d.held?' · Active legal hold':''}</p><DraftFiles draft={d}/>
      <Field label={`Disposition for ${title}`} hint={d.held?'An active hold requires retention.':'Choose deletion of this draft and its files, or a retention reason.'}><select name={`draft:${d.id}`} defaultValue="" required><option value="" disabled>Choose a disposition</option>{d.held?<option value="legal_hold">Retain: legal hold</option>:<><option value="delete">Delete draft and files</option><option value="business_retention">Retain: business retention</option><option value="request_scope">Retain: outside request scope</option><option value="legal_retention">Retain: legal retention</option></>}</select></Field>
     </fieldset>
    }):<p>No unexecuted draft files or versions match this request.</p>}
    <label className="lk-check"><input type="checkbox" required/>I approve this exact preview and the draft dispositions above.</label>
   </Form>
   <button type="button" disabled={locket.busy} onClick={()=>setReview(null)}>Discard preview</button>
  </div>}
  {result&&<div aria-label="Erasure receipt"><h3>Erasure receipt</h3><p role="status">Erasure confirmed. {result.changedRecords} records minimized.</p><p>Receipt: {result.id}</p><RetainedRecords state={state} records={result.receipt.retained}/><h3>Draft dispositions</h3>{result.receipt.drafts.length?<ul>{result.receipt.drafts.map(d=><li key={d.id}><strong>{d.id}</strong><p>{d.action==='delete'?'Deleted':'Retained'} · {words(d.reason)} · Authorizer: {state.operators.find(o=>o.id===d.authorizer)?.name??d.authorizer} ({d.authorizer})</p><DraftFiles draft={d}/></li>)}</ul>:<p>No draft dispositions.</p>}{contacts.length>0&&<button type="button" disabled={locket.busy} onClick={()=>setResult(null)}>Review another request</button>}</div>}
 </section>
}
