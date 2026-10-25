import { useState } from 'react'
import type { LocketState } from './api'
import type { Locket } from './app'
import { when, words } from './format'
export function Connections({state,locket}:{state:LocketState;locket:Locket}){
 if(state.actor.role!=='owner')return <p>Only the owner can inspect installation connections.</p>
 return <div className="lk-tab-page"><div className="lk-titlebar"><h1>Connections</h1></div><p>Read-only probes check account access. They never retry a send, signing request or accounting operation. Credentials stay in server settings. An unverified integration has no completed health proof.</p>
 {!state.connections.length&&<p>No integrations configured.</p>}
 {state.connections.map(c=><section className="lk-panel" key={c.id} aria-label={c.id+' connection'} style={{overflowWrap:'anywhere'}}><h2>{c.label??words(c.id)}</h2><dl><dt>Account</dt><dd>{c.account}</dd><dt>Verified account</dt><dd>{c.provider_account??'Not yet verified'}</dd><dt>Status</dt><dd>{words(c.status)}</dd><dt>Reason</dt><dd>{words(c.reason)}</dd><dt>Last successful probe</dt><dd>{c.last_success_at?when(c.last_success_at):'Not yet recorded'}</dd><dt>Last successful operation</dt><dd>{c.last_sync_at?when(c.last_sync_at):'Not yet recorded'}</dd><dt>Owner alert</dt><dd>{c.alert_status==='accepted'?'Accepted by provider; delivery unconfirmed':c.alert_status?words(c.alert_status):'None'}</dd></dl><h3>Affected agreements</h3>{c.agreementIds.length?<ul>{c.agreementIds.map((id:string)=><li key={id}><a href={'#agreement/'+id}>{state.agreements.find(a=>a.id===id)?.title??id}</a></li>)}</ul>:<p>No linked agreement recorded.</p>}
 {c.probe?<button type="button" disabled={locket.busy} onClick={()=>locket.run('connection.check',{id:c.id})}>{c.status==='failing'?'Retry read-only check':'Check connection'}</button>:<p>A supported read-only probe is not available for this integration yet.</p>}
 <CredentialExpiry connection={c} locket={locket} now={state.now}/>
 </section>)}<p>Reconnect by updating the provider credential in the installation secret store, then retry the read-only check. This screen never accepts credentials.</p></div>
}

function CredentialExpiry({connection:c,locket,now}:{connection:any;locket:Locket;now:number}){
 const expiry=c.credentialExpiry
 const [value,setValue]=useState(''),[consent,setConsent]=useState(false)
 const save=async(clear=false)=>{const at=clear?null:Date.parse(value+'Z');if(!clear&&!Number.isFinite(at))return;await locket.run('connection.expiry',{id:c.id,version:expiry?.version??0,expiresAt:at,consent});setConsent(false);setValue('')}
 return <div><h3>Credential expiry</h3><p>{expiry?.expires_at?<>Owner-recorded expiry: {when(expiry.expires_at)}. {expiry.expires_at<=now?'Expired.':expiry.expires_at<=now+7*86400000?'Renew within seven days.':''}</>:'Expiry unknown; no automatic expiry claim.'}</p>
 {expiry?.alert_status&&<p>Renewal alert: {expiry.alert_status==='accepted'?'Accepted by provider; delivery unconfirmed':words(expiry.alert_status)}</p>}
 <p>Record the expiry given by the provider. This does not change the credential. The hourly check sends one generic owner warning within seven days, including overdue dates.</p>
 <label>Credential expiry (UTC)<input type="datetime-local" value={value} onChange={e=>setValue(e.target.value)} /></label>
 <label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I confirm this owner-recorded expiry change.</label>
 <button type="button" disabled={locket.busy||!consent||!value} onClick={()=>save()}>Save credential expiry</button>
 {expiry?.expires_at&&<button type="button" disabled={locket.busy||!consent} onClick={()=>save(true)}>Clear recorded expiry</button>}
 </div>
}
