import {useState} from 'react'
import type {LocketState,Row} from './api'
import type {Locket} from './app'
import {Field,Form,value} from './controls'
import {can,personName,typeLabel} from './format'

type Edit={id?:string;name:string;approverId:string;escalationId:string;order:number;type:string;minimumValue:string;departmentId:string;risk:string;dataProcessing:string;findingKey:string}
const blank=(ownerId:string):Edit=>({name:'',approverId:ownerId,escalationId:ownerId,order:1,type:'',minimumValue:'',departmentId:'',risk:'',dataProcessing:'',findingKey:''})
export function ApprovalRules({state,locket}:{state:LocketState;locket:Locket}){
 if(state.actor.role!=='owner')return null
 return <section className="lk-panel"><h2>Conditional approval rules</h2><p>Draft and preview the approvers required by type, USD value, department, risk, data processing and recorded findings. Equal stage numbers run in parallel. Published rules are captured when a request is created.</p><RuleDesigner key={state.approvalRules?.version??0} state={state} locket={locket}/></section>
}
function RuleDesigner({state,locket}:{state:LocketState;locket:Locket}){
 const draft=state.approvalRules
 const [rules,setRules]=useState<Edit[]>(()=>draft?JSON.parse(draft.definition).map((r:any)=>({id:r.id,name:r.name,approverId:r.approverId,escalationId:r.escalationId??'',order:r.order,type:r.when.type??'',minimumValue:r.when.minimumCents===null?'':(r.when.minimumCents/100).toFixed(2),departmentId:r.when.departmentId??'',risk:r.when.risk??'',dataProcessing:r.when.dataProcessing===null?'':r.when.dataProcessing?'yes':'no',findingKey:r.when.findingKey??''})):[])
 const [preview,setPreview]=useState<{name:string;approverId:string;order:number}[]|null>(null)
 const people=state.operators.filter(o=>o.status==='active'&&['owner','approver'].includes(o.role))
 const departments=state.intakeAudiences.filter(a=>a.kind==='department')
 const update=(i:number,field:keyof Edit,v:any)=>setRules(rules.map((r,n)=>n===i?{...r,[field]:v}:r))
 return <>
 <Form busy={locket.busy} submit="Save approval rule draft" onSubmit={()=>void locket.run('approval.rules.save',{version:draft?.version??0,rules:rules.map(r=>({...(r.id?{id:r.id}:{}),name:r.name,approverId:r.approverId,escalationId:r.escalationId||undefined,order:r.order,when:{type:r.type||undefined,minimumValue:r.minimumValue||undefined,departmentId:r.departmentId||undefined,risk:r.risk||undefined,dataProcessing:r.dataProcessing===''?null:r.dataProcessing==='yes',findingKey:r.findingKey||undefined}}))})}>
 {rules.map((r,i)=><fieldset className="lk-fieldset" key={i}><legend>Approval rule {i+1}</legend><div className="lk-grid2">
 <Field label={`Rule ${i+1} name`}><input required value={r.name} onChange={e=>update(i,'name',e.target.value)}/></Field>
 <Field label={`Rule ${i+1} approver`}><select value={r.approverId} onChange={e=>update(i,'approverId',e.target.value)}>{people.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
 <Field label={`Rule ${i+1} stage`}><input type="number" min="1" max="50" value={r.order} onChange={e=>update(i,'order',Number(e.target.value))}/></Field>
 <Field label={`Rule ${i+1} escalation contact`}><select value={r.escalationId} onChange={e=>update(i,'escalationId',e.target.value)}><option value="">Installation owner</option>{people.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
 <Field label={`Rule ${i+1} agreement type`}><select value={r.type} onChange={e=>update(i,'type',e.target.value)}><option value="">Any type</option>{Object.entries(typeLabel).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></Field>
 <Field label={`Rule ${i+1} minimum value (USD)`} hint="Inclusive threshold; blank means any value."><input inputMode="decimal" value={r.minimumValue} onChange={e=>update(i,'minimumValue',e.target.value)}/></Field>
 <Field label={`Rule ${i+1} department`}><select value={r.departmentId} onChange={e=>update(i,'departmentId',e.target.value)}><option value="">Any department</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
 <Field label={`Rule ${i+1} counterparty risk`}><select value={r.risk} onChange={e=>update(i,'risk',e.target.value)}><option value="">Any risk</option>{['unknown','low','medium','high'].map(v=><option key={v} value={v}>{v}</option>)}</select></Field>
 <Field label={`Rule ${i+1} data processing`}><select value={r.dataProcessing} onChange={e=>update(i,'dataProcessing',e.target.value)}><option value="">Either</option><option value="yes">Yes</option><option value="no">No</option></select></Field>
 <Field label={`Rule ${i+1} finding clause key`} hint="Optional; matches a person-recorded breached or undetermined finding."><input value={r.findingKey} onChange={e=>update(i,'findingKey',e.target.value)}/></Field>
 </div><button type="button" onClick={()=>setRules(rules.filter((_,n)=>n!==i))}>Remove approval rule {i+1}</button></fieldset>)}
 <button type="button" onClick={()=>setRules([...rules,blank(state.actor.id)])}>Add approval rule</button>
 </Form>
 {draft&&<><h3>Preview this draft</h3><Form busy={locket.busy} submit="Preview approval rules" onSubmit={async data=>{const result=await locket.run('approval.rules.preview',{version:draft.version,sample:{type:value(data,'type'),value:value(data,'amount'),departmentId:value(data,'department'),risk:value(data,'risk'),dataProcessing:value(data,'dataProcessing')==='yes',findingKeys:value(data,'findings').split(',').map(s=>s.trim()).filter(Boolean)}});if(result)setPreview(result.steps)}}><div className="lk-grid2">
 <Field label="Sample approval type"><select name="type" defaultValue="supplier">{Object.entries(typeLabel).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></Field>
 <Field label="Sample approval value (USD)"><input name="amount" inputMode="decimal" defaultValue="600000"/></Field>
 <Field label="Sample approval department"><select name="department"><option value="">No department</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
 <Field label="Sample counterparty risk"><select name="risk" defaultValue="medium">{['unknown','low','medium','high'].map(v=><option key={v} value={v}>{v}</option>)}</select></Field>
 <Field label="Sample data processing"><select name="dataProcessing"><option value="no">No</option><option value="yes">Yes</option></select></Field>
 <Field label="Sample finding clause keys"><input name="findings"/></Field>
 </div></Form>
 {preview&&<div role="status" aria-label="Approval rule preview"><h3>Required approval stages</h3>{preview.length?<ol>{preview.map((r,i)=><li key={i}>Stage {r.order}: {r.name} · {personName(state,r.approverId)}</li>)}</ol>:<p>No extra approver matches. Existing commercial and legal-exception approval still apply.</p>}</div>}
 <button type="button" disabled={locket.busy||draft.previewed_version!==draft.version} onClick={()=>void locket.run('approval.rules.publish',{version:draft.version})}>Publish approval rules</button>
 {draft.published_id&&<p className="lk-muted">A published version is available to new review requests.</p>}</>}
 </>
}
export function ApprovalRoutingInputs({state,a,locket}:{state:LocketState;a:Row;locket:Locket}){
 if(!can(state,'owner','counsel','approver','requester')||!['draft','in_review','approved'].includes(a.status))return null
 if(state.requestForms.some(r=>r.agreement_id===a.id))return <section className="lk-panel"><h2>Approval routing answers</h2><p>These routing answers are retained from the published request form. A later rule publication or metadata edit does not rewrite the original answers.</p></section>
 const prior=state.approvalInputs.find(r=>r.agreement_id===a.id)
 return <section className="lk-panel"><h2>Approval routing answers</h2><Form key={a.version} busy={locket.busy} submit="Save approval routing answers" onSubmit={data=>void locket.run('approval.inputs',{agreementId:a.id,version:a.version,risk:value(data,'risk'),dataProcessing:value(data,'dataProcessing')==='yes'})}><div className="lk-grid2"><Field label="Counterparty risk"><select name="risk" defaultValue={prior?.risk??'unknown'}>{['unknown','low','medium','high'].map(v=><option key={v} value={v}>{v}</option>)}</select></Field><Field label="Data processing"><select name="dataProcessing" defaultValue={prior?.data_processing?'yes':'no'}><option value="no">No</option><option value="yes">Yes</option></select></Field></div><p>Changing these recorded answers withdraws prior approvals. A person must review the agreement before recording them.</p></Form></section>
}
export function ApprovalAvailability({state,locket}:{state:LocketState;locket:Locket}){
 const [selected,setSelected]=useState(state.actor.id)
 if(!can(state,'owner','approver'))return null
 const people=state.operators.filter(o=>o.status==='active'&&['owner','approver'].includes(o.role)),prior=state.approvalAbsences.find(a=>a.operator_id===selected)
 return <section className="lk-panel"><h2>Approver availability</h2><p>Away delegates receive no new agreement access. Decisions name the actual person acting for the absent approver.</p>
 {state.actor.role==='owner'&&<Field label="Approver to configure"><select value={selected} onChange={e=>setSelected(e.target.value)}>{people.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>}
 <Form key={selected+':'+(prior?.version??0)} busy={locket.busy} submit="Save approval availability" onSubmit={data=>void locket.run('approval.availability',{operatorId:selected,version:prior?.version??0,away:data.get('away')==='on',delegateId:value(data,'delegate')||undefined})}><label className="lk-check"><input name="away" type="checkbox" defaultChecked={!!prior?.away}/> Away from approvals</label><Field label="Named away delegate"><select name="delegate" defaultValue={prior?.delegate_id??''}><option value="">No delegate</option>{people.filter(o=>o.id!==selected).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></Field></Form></section>
}
