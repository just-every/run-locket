import { useEffect, useState } from 'react'
import { fetchJson, type LocketState, type Row } from './api'
import type { Locket } from './app'
import { Field } from './controls'
import { typeLabel, money, day } from './format'
import { standardBulkFields } from '../locket/repository-bulk-fields'

interface Operation {operationId:string;status:string;total:number;changed:number;applied:number;reverted:number;skipped:number;pending:number;offset:number;proposal?:{preparedBy:string;decidedBy:string|null;evidence:string[];assumptions:string};rows:{agreementId:string;reference:string;title:string;outcome:string;reason:string|null;diff:Record<string,{before:unknown;after:unknown}>}[]}
const standardLabels:Record<string,string>={title:'Title',type:'Agreement type',value:'Value (USD)',needed_by:'Needed by',start_date:'Start date',timezone:'Time zone',entity:'Our entity',department:'Department',groups:'Access groups',owner:'Responsible person',restricted:'Restricted access'}
export function RepositoryBulk({state,locket,rows}:{state:LocketState;locket:Locket;rows:Row[]}){
 const [source,setSource]=useState('current'),[selected,setSelected]=useState<string[]>([]),[all,setAll]=useState(true)
 const [operation,setOperation]=useState<Operation|null>(null),[history,setHistory]=useState<Row[]>([]),[field,setField]=useState(state.actor.role==='owner'?'department':'title'),[value,setValue]=useState(''),[clear,setClear]=useState(false),[csv,setCsv]=useState(''),[running,setRunning]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState('')
 const editable=['owner','counsel','approver','requester'].includes(state.actor.role)&&!state.fieldAccess.hidden.length
 const display=(key:string,v:unknown):string=>{
  if(v===null)return '(empty)'
  if(key==='type')return typeLabel[String(v)]??String(v)
  if(key==='owner')return state.operators.find(o=>o.id===v)?.name??'Former person'
  if(key==='entity')return state.entities.find(e=>e.id===v)?.legal_name??'Not recorded'
  if(key==='department')return state.intakeAudiences.find(a=>a.id===v)?.name??'Unavailable department'
  if(key==='groups'&&Array.isArray(v))return v.map(id=>state.intakeAudiences.find(a=>a.id===id)?.name??'Unavailable group').join(', ')||'(empty)'
  const custom=state.customFields.find(f=>'custom:'+f.id===key)
  if((key==='value'||custom?.kind==='money')&&typeof v==='number')return money(v)
  if((key==='needed_by'||key==='start_date'||custom?.kind==='date')&&typeof v==='string')return day(v)
  if(typeof v==='boolean')return v?'Yes':'No'
  return typeof v==='object'?JSON.stringify(v):String(v)
 }
 const path=(id:string,extra='')=>`/api/locket/repository/bulk?operationId=${encodeURIComponent(id)}${extra}`
 const load=async(id:string,offset=0)=>{const op=await fetchJson<Operation>(path(id,'&offset='+offset));setOperation(op);return op}
 const refreshHistory=async()=>{const r=await fetchJson<{operations:Row[]}>('/api/locket/repository/bulk');setHistory(r.operations)}
 useEffect(()=>{if(editable)void refreshHistory().catch(e=>setError(e.message))},[state.actor.id,editable])
 if(!editable)return <p className="lk-note">Bulk repository actions require a human editor with full field access. Agents prepare proposals for an authorized person.</p>
 const perform=async(work:()=>Promise<unknown>)=>{setRunning(true);setError('');try{await work();await refreshHistory()}catch(e){setError((e as Error).message)}finally{setRunning(false)}}
 const busy=running||locket.busy
 const prepareSelection=()=>perform(async()=>{
  const result=await locket.run('repository.bulk.select',source==='current'?{agreementIds:all?rows.map(a=>a.id):selected.filter(id=>rows.some(a=>a.id===id))}:{viewId:source})
  if(result){await load(result.operationId);setProgress('Selection saved. Download metadata CSV or prepare a field change.');setCsv('')}
 })
 const fieldDefinition=state.customFields.find(f=>'custom:'+f.id===field)
 const choices=field==='type'?Object.entries(typeLabel).map(([id,name])=>({id,name})):field==='department'||field==='groups'?state.intakeAudiences.filter(a=>a.kind===(field==='groups'?'group':'department')):field==='owner'||fieldDefinition?.kind==='person'?state.operators:field==='entity'?state.entities.map(e=>({id:e.id,name:e.legal_name})):fieldDefinition?.kind==='counterparty'?state.parties:fieldDefinition?.kind==='pick_list'?JSON.parse(fieldDefinition.options).map((s:string)=>({id:s,name:s})):null
 const parsedValue=()=>clear?null:field==='groups'?[value]:field==='restricted'||fieldDefinition?.kind==='yes_no'?value==='true':fieldDefinition?.kind==='number'?Number(value):value
 const finishReview=async(id:string)=>{
  let remaining=true
  while(remaining){const r=await locket.run('repository.bulk.review',{operationId:id});if(!r)break;setProgress(`${r.remaining} records remaining in dry-run review.`);remaining=r.remaining>0}
  await load(id)
 }
 const continueOperation=()=>perform(async()=>{
  if(!operation)return
  let remaining=true
  while(remaining){
   const r=await locket.run('repository.bulk.next',{operationId:operation.operationId})
   if(!r)break
   setProgress(`${r.remaining} reviewed records remaining.`);remaining=r.remaining>0
  }
  await load(operation.operationId)
 })
 return <section className="lk-panel" aria-label="Bulk repository actions">
  <h2>Bulk repository actions</h2><p>Select up to 5,000 agreements from the current search and stage filter, or a saved view. Review changes before applying them. Changed or inaccessible records are skipped; every applied change keeps its history.</p>
  {error&&<p role="alert" className="lk-alert">{error}</p>}
  <Field label="Bulk selection source"><select value={source} onChange={e=>setSource(e.target.value)}><option value="current">Current search and stage filter ({rows.length})</option>{state.savedViews.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
  {source==='current'&&<><label className="lk-check"><input type="checkbox" checked={all} onChange={e=>setAll(e.target.checked)}/>Select all matching agreements</label>{!all&&<details open><summary>Select individual agreements ({selected.length} selected)</summary>{rows.map(a=><label key={a.id} className="lk-check"><input aria-label={`Select ${a.title}`} type="checkbox" checked={selected.includes(a.id)} onChange={e=>setSelected(e.target.checked?[...selected,a.id]:selected.filter(id=>id!==a.id))}/>{a.title}</label>)}</details>}</>}
  <button className="lk-button" type="button" disabled={busy} onClick={()=>void prepareSelection()}>Save bulk selection</button>
  {history.length>0&&<Field label="Resume bulk operation"><select value={operation?.operationId??''} onChange={e=>{if(e.target.value)void perform(()=>load(e.target.value))}}><option value="">Choose a saved operation</option>{history.map(h=><option key={h.id} value={h.id}>{new Date(h.created_at).toLocaleString()} · {h.status} · {h.id.slice(0,8)}</option>)}</select></Field>}
  {operation&&<>
   <p role="status">{operation.total} selected · {operation.changed} changed in dry run · {operation.applied} applied · {operation.reverted} reverted · {operation.skipped} skipped · {operation.status}</p>
   {operation.proposal&&<aside><p>Proposal prepared by {state.operators.find(o=>o.id===operation.proposal!.preparedBy)?.name??operation.proposal.preparedBy}.</p><p>Evidence: {operation.proposal.evidence.join('; ')}</p><p>Assumptions: {operation.proposal.assumptions||'None recorded.'}</p></aside>}
   {progress&&<p aria-live="polite">{progress}</p>}
   <p><a className="lk-button" href={path(operation.operationId,'&format=zip')} download>Download selected files ZIP</a>{operation.status==='selected'&&<> <a className="lk-button" href={path(operation.operationId,'&format=csv')} download>Export metadata CSV</a></>}</p>
   {operation.status==='selected'&&<>
    <Field label="Bulk field"><select value={field} onChange={e=>{setField(e.target.value);setValue('');setClear(false)}}>{standardBulkFields.filter(f=>!['department','restricted'].includes(f)||state.actor.role==='owner').filter(f=>!['entity','groups'].includes(f)||['owner','counsel'].includes(state.actor.role)).map(f=><option key={f} value={f}>{f==='groups'?'Group access':f==='owner'?'Responsible person and open work':f.replaceAll('_',' ')}</option>)}{state.customFields.map(f=><option key={f.id} value={'custom:'+f.id}>{f.name}</option>)}</select></Field>
    {!['title','type','owner','timezone','restricted'].includes(field)&&<label className="lk-check"><input type="checkbox" checked={clear} onChange={e=>setClear(e.target.checked)}/>Clear field</label>}
    {!clear&&<Field label="Bulk field value">{choices?<select value={value} onChange={e=>setValue(e.target.value)}><option value="">Choose a value</option>{choices.map((v:Row)=><option key={v.id} value={v.id}>{v.name??v.id}</option>)}</select>:field==='restricted'||fieldDefinition?.kind==='yes_no'?<select value={value} onChange={e=>setValue(e.target.value)}><option value="">Choose yes or no</option><option value="true">Yes</option><option value="false">No</option></select>:<input value={value} type={field==='needed_by'||field==='start_date'||fieldDefinition?.kind==='date'?'date':'text'} onChange={e=>setValue(e.target.value)}/>}</Field>}
    <button className="lk-button" disabled={busy||(!clear&&!value)} type="button" onClick={()=>void perform(async()=>{const result=await locket.run('repository.bulk.preview',{operationId:operation.operationId,changes:{[field]:clear&&field==='groups'?[]:parsedValue()}});if(result)await finishReview(operation.operationId)})}>Preview field changes</button>
    <details><summary>Re-import corrected metadata CSV</summary><p>Keep agreement_id and version. Only changed cells are updates. Empty cells clear optional values. Group and person fields use their exported identities.</p><Field label="Metadata CSV file"><input type="file" accept=".csv,text/csv" onChange={e=>{const f=e.target.files?.[0];if(f)void f.text().then(setCsv)}}/></Field><Field label="Metadata CSV"><textarea value={csv} onChange={e=>setCsv(e.target.value)} rows={5}/></Field><button className="lk-button" type="button" disabled={busy||!csv} onClick={()=>void perform(async()=>{const result=await locket.run('repository.bulk.preview',{operationId:operation.operationId,csv});if(result)await finishReview(operation.operationId)})}>Preview CSV changes</button></details>
   </>}
   {operation.status==='proposed'&&<p><button className="lk-button" type="button" disabled={busy} onClick={()=>void perform(async()=>{const r=await locket.run('repository.bulk.proposal.decide',{operationId:operation.operationId,decision:'review'});if(r)await finishReview(operation.operationId)})}>Review proposed bulk changes</button> <button className="lk-button" type="button" disabled={busy} onClick={()=>void perform(async()=>{const r=await locket.run('repository.bulk.proposal.decide',{operationId:operation.operationId,decision:'reject'});if(r)await load(operation.operationId)})}>Reject bulk proposal</button></p>}
   {operation.status==='previewing'&&<button className="lk-button" type="button" disabled={busy} onClick={()=>void perform(()=>finishReview(operation.operationId))}>Continue dry-run review</button>}
   {['reviewed','applying','reverting'].includes(operation.status)&&<button className="lk-button lk-primary" disabled={busy} type="button" onClick={()=>void continueOperation()}>{operation.status==='reverting'?'Continue restoring prior values':operation.status==='applying'?'Continue reviewed changes':'Apply exact dry run'}</button>}
   {operation.status==='done'&&<button className="lk-button" type="button" disabled={busy} onClick={()=>void perform(async()=>{const r=await locket.run('repository.bulk.revert',{operationId:operation.operationId});if(r){await load(operation.operationId);setProgress('Restoration prepared. Continue restoring prior values to finish.')}})}>Revert bulk operation</button>}
   <h3>Record differences and outcomes</h3>{operation.rows.map(row=><details key={row.agreementId}><summary>{row.reference} · {row.title} · {row.outcome}</summary>{row.reason&&<p>{row.reason}</p>}<dl>{Object.entries(row.diff).map(([key,v])=><div key={key}><dt>{state.customFields.find(f=>'custom:'+f.id===key)?.name??standardLabels[key]??key}</dt><dd style={{overflowWrap:'anywhere'}}>{display(key,v.before)} → {display(key,v.after)}</dd></div>)}</dl></details>)}
   <p><button type="button" disabled={busy||operation.offset===0} onClick={()=>void perform(()=>load(operation.operationId,Math.max(0,operation.offset-50)))}>Previous records</button> <button type="button" disabled={busy||operation.offset+50>=operation.total} onClick={()=>void perform(()=>load(operation.operationId,operation.offset+50))}>Next records</button></p>
  </>}
 </section>
}
