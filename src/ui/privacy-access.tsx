import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
export function PrivacyAccess({state,party,locket}:{state:LocketState;party:Row;locket:Locket}){
 if(state.actor.role!=='owner')return null
 const members=state.operators.filter(o=>o.status==='active'&&!['owner','agent'].includes(o.role))
 return <section className="lk-panel" aria-label="Scoped privacy authority"><h2>Scoped privacy authority</h2><p>A privacy delegate can review and confirm verified erasure requests for this counterparty. Their current agreement and field access still applies. Requests touching another scope are refused. This grants no legal-hold release or retention-rule authority.</p>
 {state.privacyScopes.filter(s=>s.party_id===party.id).map(s=><p key={s.operator_id}>{state.operators.find(o=>o.id===s.operator_id)?.name??s.operator_id} <button type="button" disabled={locket.busy} onClick={()=>locket.run('privacy.scope',{partyId:party.id,operatorId:s.operator_id,enabled:false})}>Revoke privacy authority</button></p>)}
 {members.length>0&&<Form busy={locket.busy} submit="Grant privacy authority" onSubmit={data=>locket.run('privacy.scope',{partyId:party.id,operatorId:value(data,'operatorId'),enabled:true})}><Field label="Privacy delegate"><select name="operatorId">{members.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></Field><label className="lk-check"><input type="checkbox" required/>I authorize verified erasure within this counterparty scope.</label></Form>}
 </section>
}
export function ErasureRecovery({state,locket}:{state:LocketState;locket:Locket}){
 if(state.actor.role!=='owner'||!state.erasureRecovery.length)return null
 return <section className="lk-panel" aria-label="Historical erasure recovery"><h2>Historical erasure recovery</h2><p>Personal-data entry and imports are paused until every historical request has private re-entry protection. Verify the original address against the original request. Historical documents and audit remain unchanged.</p><Form busy={locket.busy} submit="Restore private protection" onSubmit={data=>locket.run('erasure.recover',{subjectToken:value(data,'subjectToken'),email:value(data,'email'),method:value(data,'method'),verified:data.get('verified')==='on'})}><Field label="Historical request"><select name="subjectToken">{state.erasureRecovery.map(e=><option key={e.subject_token}>{e.subject_token}</option>)}</select></Field><Field label="Verified original email"><input name="email" type="email" required/></Field><Field label="Historical verification method"><select name="method"><option value="established_channel">Established contact channel</option><option value="in_person">In person</option><option value="verified_letter">Verified letter</option></select></Field><label className="lk-check"><input name="verified" type="checkbox" required/>I verified this address against the original privacy request.</label></Form></section>
}
