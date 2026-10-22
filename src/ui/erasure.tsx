import { useState } from 'react'
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { can, parse, when } from './format'

export function EraseContact({state,party,locket}:{state:LocketState;party:Row;locket:Locket}){
 const contacts=parse<{name:string;email:string}[]>(party.contacts??'[]').filter(c=>!c.email.endsWith('@invalid.example'))
 if(!can(state,'owner')||!contacts.length)return null
 return <section className="lk-panel" aria-label="Verified personal-data erasure"><h2>Verified personal-data erasure</h2><p>Erase this contact’s name and email from contacts, comments, notices and notification addressing. Original files, signatures and audit history are retained.</p><Form busy={locket.busy} submit="Erase verified contact" onSubmit={data=>locket.run('person.erase',{email:value(data,'email'),verified:data.get('verified')==='on',verification:value(data,'verification'),reason:value(data,'reason')})}>
 <Field label="Contact to erase"><select name="email">{contacts.map(c=><option key={c.email} value={c.email}>{c.name} · {c.email}</option>)}</select></Field>
 <Field label="How the request was verified"><input name="verification" required/></Field><Field label="Erasure reason"><input name="reason" required/></Field>
 <label className="lk-check"><input type="checkbox" name="verified" required/>I verified this person’s erasure request and approve this erasure.</label>
 </Form></section>
}
export function LegalHold({state,a,locket}:{state:LocketState;a:Row;locket:Locket}){
 const hold=state.legalHolds.find(h=>h.agreement_id===a.id)
 return <section className="lk-panel" aria-label="Legal hold"><h2>Legal hold</h2><p>{hold?.active?`Active: ${hold.reason}. Deletion and file removal are refused.`:hold?`Released: ${hold.release_reason}`:'No legal hold recorded.'}</p>
 {can(state,'counsel')&&<Form busy={locket.busy} submit={hold?.active?'Release legal hold':'Set legal hold'} onSubmit={data=>locket.run('hold.set',{agreementId:a.id,version:a.version,holdVersion:hold?.version??0,active:!hold?.active,reason:value(data,'reason')})}><Field label="Legal hold reason"><input name="reason" required/></Field></Form>}
 {can(state,'owner')&&a.status==='draft'&&a.origin==='intake'&&<details><summary>Delete this unexecuted draft</summary><p>This removes the draft and its files. Audit history remains. An active legal hold must be released by counsel first.</p><Form busy={locket.busy} submit="Delete draft and files" onSubmit={async data=>{const result=await locket.run('draft.delete',{agreementId:a.id,version:a.version,reason:value(data,'reason')});if(result)window.location.hash='agreements'}}><Field label="Draft deletion reason"><input name="reason" required/></Field></Form></details>}
 </section>
}
export function DraftRetention({state,locket}:{state:LocketState;locket:Locket}){
 const[preview,setPreview]=useState<{id:string;candidates:Row[]}|null>(null),rule=state.retentionRule
 if(!can(state,'owner'))return null
 return <section className="lk-panel" aria-label="Draft retention"><h2>Draft retention</h2><p>Expire native unexecuted drafts by age. Review up to 100 eligible drafts per preview and approve their deletion explicitly. Held drafts, executed agreements and linked parent drafts are retained.</p>
 <Form busy={locket.busy} submit="Save retention period" onSubmit={data=>locket.run('retention.configure',{version:rule?.version??0,days:Number(value(data,'days'))})}><Field label="Draft retention days"><input type="number" name="days" min="1" max="36500" defaultValue={rule?.days??365} required/></Field></Form>
 {rule&&<button type="button" disabled={locket.busy} onClick={async()=>{const result=await locket.run('retention.preview',{});if(result)setPreview(result)}}>Preview expired drafts</button>}
 {preview&&<div><p>{preview.candidates.length} expired drafts. Nothing has been deleted.</p><ul>{preview.candidates.map(a=><li key={a.id}>{a.title}</li>)}</ul>{preview.candidates.length>0&&<Form busy={locket.busy} submit="Approve previewed deletions" onSubmit={async data=>{const result=await locket.run('retention.apply',{previewId:preview.id,reason:value(data,'reason')});if(result)setPreview(null)}}><Field label="Retention deletion reason"><input name="reason" required/></Field><label className="lk-check"><input type="checkbox" required/>I approve deletion of exactly these drafts and files.</label></Form>}</div>}
 {state.erasures.length>0&&<details><summary>Erasure history</summary><ul>{state.erasures.map(r=><li key={r.id}>{when(r.at)} · {r.changed_records} records · {r.reason}</li>)}</ul></details>}
 </section>
}
