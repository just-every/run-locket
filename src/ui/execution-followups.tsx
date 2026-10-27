import { useState } from 'react'
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Badge, Field, Form, value } from './controls'
import { parse, when } from './format'

export function ExecutionFollowups({state,a,locket}:{state:LocketState;a:Row;locket:Locket}) {
 const [kind,setKind]=useState('extraction'),[consent,setConsent]=useState(false)
 const pkg=state.packages.find(p=>p.agreement_id===a.id&&['sent','completed'].includes(p.status))
 const destination=state.executionDestinations?.find(d=>d.kind===kind)
 const rows=(state.executionFollowups??[]).filter(r=>r.agreement_id===a.id)
 return <section className="lk-panel" aria-label="Execution follow-up actions"><h2>Execution follow-up actions</h2>
 <p>Retrieval consent covers retrieval only. Authorize each destination separately. Filing and CRM writes wait for clean reconciliation. An uncertain write needs inspection and is never resent automatically.</p>
 {rows.map(r=><article className="lk-card" key={r.id} style={{overflowWrap:'anywhere'}}><strong>{r.kind}</strong> <Badge value={r.status}/><p>Authorized {when(r.created_at)}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(parse(r.destination),null,2)}</pre>{r.outcome&&<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(parse(r.outcome),null,2)}</pre>}{state.actor.role==='owner'&&r.status==='waiting'&&<button disabled={locket.busy} onClick={()=>locket.run('execution.followup.cancel',{agreementId:a.id,version:a.version,id:r.id})}>Cancel action</button>}</article>)}
 {state.actor.role==='owner'&&pkg&&<Form busy={locket.busy} submit="Authorize separate action" onSubmit={async data=>{
 await locket.run('execution.followup.authorize',{agreementId:a.id,version:a.version,packageId:pkg.id,kind,consent:data.get('consent')==='on',simulated:data.get('simulated')==='on',accountId:destination?.account_id,connectionRevision:destination?.revision,folderId:value(data,'folderId'),namingRule:value(data,'namingRule'),dealId:value(data,'dealId'),property:value(data,'property'),value:value(data,'propertyValue')});setConsent(false)
 }}>
 <p style={{overflowWrap:'anywhere'}}>Exact package {pkg.id} · envelope {pkg.envelope_id}<br/>Approved document digest: {pkg.version_digest}</p>
 <Field label="Execution action"><select value={kind} onChange={e=>{setKind(e.target.value);setConsent(false)}}><option value="extraction">Start extraction</option><option value="google-drive">File in Google Drive</option><option value="onedrive">File in OneDrive</option><option value="sharepoint">File in SharePoint</option><option value="chest">File in Chest</option><option value="hubspot">Update HubSpot deal</option></select></Field>
 {kind==='extraction'?<><p>Extraction uses the current model settings and evaluation gate. Output remains proposed until human review.</p>{state.models?.simulationAvailable&&<label className="lk-check"><input type="checkbox" name="simulated"/> Use provider simulation, labelled simulated</label>}</>:<><p>Destination account: {destination?.account_id??'Configure this destination in Settings connections first.'}{destination&&` · revision ${destination.revision}`}</p>{kind==='hubspot'?<><Field label="HubSpot deal ID"><input name="dealId" required/></Field><Field label="Confirmed status property"><input name="property" defaultValue="contract_status" required/></Field><Field label="Confirmed executed value"><input name="propertyValue" defaultValue="executed" required/></Field></>:<><Field label="Destination folder ID"><input name="folderId" required/></Field><Field label="Owner filename rule"><input name="namingRule" defaultValue="{reference}-{role}" required/></Field><p>Use {'{reference}'} and {'{role}'} so the signed PDF and certificate have distinct names.</p></>}</>}
 <label className="lk-check"><input type="checkbox" name="consent" checked={consent} onChange={e=>setConsent(e.target.checked)} required/> I authorize only this displayed action, exact package and destination.</label>
 </Form>}
 </section>
}
