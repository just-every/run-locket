import type { LocketState } from './api'
import type { Locket } from './app'
import { when, words } from './format'
export function Connections({state,locket}:{state:LocketState;locket:Locket}){
 if(state.actor.role!=='owner')return <p>Only the owner can inspect installation connections.</p>
 return <div className="lk-tab-page"><div className="lk-titlebar"><h1>Connections</h1></div><p>Read-only probes check account access. They never retry a send, signing request or accounting operation. Credentials stay in server settings. An unverified integration has no completed health proof.</p>
 {!state.connections.length&&<p>No integrations configured.</p>}
 {state.connections.map(c=><section className="lk-panel" key={c.id} aria-label={c.id+' connection'} style={{overflowWrap:'anywhere'}}><h2>{words(c.id)}</h2><dl><dt>Account</dt><dd>{c.account}</dd><dt>Verified account</dt><dd>{c.provider_account??'Not yet verified'}</dd><dt>Status</dt><dd>{words(c.status)}</dd><dt>Reason</dt><dd>{words(c.reason)}</dd><dt>Last successful probe</dt><dd>{c.last_success_at?when(c.last_success_at):'Not yet recorded'}</dd><dt>Owner alert</dt><dd>{c.alert_status==='accepted'?'Accepted by provider; delivery unconfirmed':c.alert_status?words(c.alert_status):'None'}</dd></dl><h3>Affected agreements</h3>{c.agreementIds.length?<ul>{c.agreementIds.map((id:string)=><li key={id}><a href={'#agreement/'+id}>{state.agreements.find(a=>a.id===id)?.title??id}</a></li>)}</ul>:<p>No linked agreement recorded.</p>}
 {c.probe?<button type="button" disabled={locket.busy} onClick={()=>locket.run('connection.check',{id:c.id})}>{c.status==='failing'?'Retry read-only check':'Check connection'}</button>:<p>A supported read-only probe is not available for this integration yet.</p>}
 </section>)}<p>Reconnect by updating the provider credential in the installation secret store, then retry the read-only check. This screen never accepts credentials.</p></div>
}
