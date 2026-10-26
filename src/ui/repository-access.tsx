import {useState} from 'react'
import type {LocketState,Row} from './api'
import type {Locket} from './app'
import {Field,Form,value} from './controls'
import {typeLabel} from './format'

export function RepositoryAccess({state,locket}:{state:LocketState;locket:Locket}){
 if(state.actor.role!=='owner'||!state.repositoryPolicy)return null
 return <section className="lk-panel"><h2>Repository access</h2><p>Group and department rules further limit existing agreement access. Enabling rules denies access unless a current membership matches, even on a person’s own agreement. Unclassified agreements do not match department-scoped grants. Owner and counsel retain full access.</p><AccessEditor key={state.repositoryPolicy.version} state={state} locket={locket}/></section>
}
function AccessEditor({state,locket}:{state:LocketState;locket:Locket}){
 const policy=state.repositoryPolicy!,[enabled,setEnabled]=useState(policy.enabled),[grants,setGrants]=useState(policy.grants),[hidden,setHidden]=useState(policy.hiddenFields)
 const fields=[{id:'value',name:'Agreement value'},{id:'pricing_schedules',name:'Pricing schedules'},...state.customFields.map(f=>({id:'custom:'+f.id,name:f.name}))]
 return <Form busy={locket.busy} submit="Save repository access" onSubmit={()=>void locket.run('repository.access',{version:policy.version,enabled,grants,hiddenFields:hidden})}>
 <label className="lk-check"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> Require a matching group or department grant</label>
 {grants.map((g,i)=><fieldset className="lk-fieldset" key={i}><legend>Visibility grant {i+1}</legend><Field label={`Grant ${i+1} audience`}><select value={g.audienceId} onChange={e=>setGrants(grants.map((v,n)=>n===i?{...v,audienceId:e.target.value}:v))}><option value="">Choose an audience</option>{state.intakeAudiences.map(a=><option key={a.id} value={a.id}>{a.name} ({a.kind})</option>)}</select></Field>
 <fieldset className="lk-fieldset"><legend>Visible agreement types</legend>{Object.entries(typeLabel).map(([id,label])=><label className="lk-check" key={id}><input type="checkbox" checked={g.types.includes(id)} onChange={e=>setGrants(grants.map((v,n)=>n===i?{...v,types:e.target.checked?[...v.types,id]:v.types.filter(t=>t!==id)}:v))}/>{label}</label>)}</fieldset>
 <fieldset className="lk-fieldset"><legend>Agreement departments (none means any)</legend>{state.intakeAudiences.filter(a=>a.kind==='department').map(d=><label className="lk-check" key={d.id}><input type="checkbox" checked={g.departmentIds.includes(d.id)} onChange={e=>setGrants(grants.map((v,n)=>n===i?{...v,departmentIds:e.target.checked?[...v.departmentIds,d.id]:v.departmentIds.filter(t=>t!==d.id)}:v))}/>{d.name}</label>)}</fieldset>
 <button type="button" onClick={()=>setGrants(grants.filter((_,n)=>n!==i))}>Remove grant {i+1}</button></fieldset>)}
 <button type="button" onClick={()=>setGrants([...grants,{audienceId:'',types:['customer'],departmentIds:[]}])}>Add visibility grant</button>
 <h3>Fields hidden by role or group</h3><p>Affected roles receive structured fields only. Original documents, comparisons, free-text evidence and business actions are withheld to prevent hidden values leaking; originals remain unchanged. Affected roles cannot request, update, approve, comment, coordinate signing or run reports. Approval rules skip these approvers.</p>
 {['approver','requester','viewer','agent'].map(role=><fieldset className="lk-fieldset" key={role}><legend>{role}</legend>{fields.map(f=><label className="lk-check" key={f.id}><input aria-label={`Hide ${f.name} from ${role}`} type="checkbox" checked={hidden.find(h=>h.role===role)?.fields.includes(f.id)??false} onChange={e=>{const kept=hidden.find(h=>h.role===role)?.fields??[];setHidden([...hidden.filter(h=>h.role!==role),{role,fields:e.target.checked?[...kept,f.id]:kept.filter(id=>id!==f.id)}])}}/>{f.name}</label>)}</fieldset>)}
 <h3>Fields hidden by group</h3><p>Group restrictions combine with role restrictions. Owner and counsel retain full access.</p>
 {state.intakeAudiences.filter(a=>a.kind==='group').map(group=><fieldset className="lk-fieldset" key={group.id}><legend>{group.name}</legend>{fields.map(f=><label className="lk-check" key={f.id}><input aria-label={`Hide ${f.name} from group ${group.name}`} type="checkbox" checked={hidden.find(h=>h.audienceId===group.id)?.fields.includes(f.id)??false} onChange={e=>{const kept=hidden.find(h=>h.audienceId===group.id)?.fields??[];setHidden([...hidden.filter(h=>h.audienceId!==group.id),{role:'',audienceId:group.id,fields:e.target.checked?[...kept,f.id]:kept.filter(id=>id!==f.id)}])}}/>{f.name}</label>)}</fieldset>)}
 </Form>
}
export function AgreementDepartment({state,a,locket}:{state:LocketState;a:Row;locket:Locket}){
 if(state.actor.role!=='owner')return null
 return <details className="lk-disclosure"><summary>Agreement department</summary><Form busy={locket.busy} submit="Save agreement department" onSubmit={data=>void locket.run('agreement.department',{agreementId:a.id,version:a.version,departmentId:value(data,'department')})}><Field label="Department"><select name="department" defaultValue={state.agreementDepartments.find(d=>d.agreement_id===a.id)?.department_id??''}><option value="" disabled>Choose a department</option>{state.intakeAudiences.filter(d=>d.kind==='department').map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field></Form></details>
}
