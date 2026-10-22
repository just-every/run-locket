import type { LocketState } from './api'
import { words } from './format'

export interface ErasurePatch { table:string; id:string; agreementId:string|null; before:Record<string,unknown>; after:Record<string,unknown> }
export interface RetainedRecord { table:string; id:string; agreementId:string|null; reason:string; authorizer:string; holdReason?:string }
export interface ErasureDraft { id:string; version:number; held:boolean; files:{id:string;role:string}[]; versions:string[] }
export interface ErasurePreview { id:string; fingerprint:string; patches:ErasurePatch[]; retained:RetainedRecord[]; drafts:ErasureDraft[]; subjectToken:string }
export interface DraftChoice { agreementId:string; action:'delete'|'retain'; reason:'legal_hold'|'business_retention'|'request_scope'|'legal_retention' }
export interface ErasureResult { id:string; changedRecords:number; receipt:{retained:RetainedRecord[];drafts:(ErasureDraft&Pick<DraftChoice,'action'|'reason'>&{authorizer:string})[]} }

export function AgreementReference({state,id}:{state:LocketState;id:string|null}){
 if(!id)return null
 const agreement=state.agreements.find(a=>a.id===id)
 return <p>Agreement: <a href={`#agreement/${id}`}>{agreement?.title??id}</a> · {id}</p>
}
export function RetainedRecords({state,records}:{state:LocketState;records:RetainedRecord[]}){
 return <div><h3>Retained records</h3>{records.length?<ul>{records.map((r,i)=><li key={`${r.table}:${r.id}:${r.agreementId}:${i}`}>
  <strong>{words(r.table.replace(/^lk_/,''))}</strong> · {r.id}
  <AgreementReference state={state} id={r.agreementId}/>
  <p>{words(r.reason)} · Authorizer: {state.operators.find(o=>o.id===r.authorizer)?.name??r.authorizer} ({r.authorizer}){r.holdReason&&<> · Hold reason: {r.holdReason}</>}</p>
 </li>)}</ul>:<p>No retained records in this request.</p>}</div>
}
export function DraftFiles({draft}:{draft:ErasureDraft}){
 return <><h4>Files</h4>{draft.files.length?<ul>{draft.files.map(f=><li key={f.id}>{f.id} · {words(f.role)}</li>)}</ul>:<p>No files.</p>}<h4>Versions</h4>{draft.versions.length?<ul>{draft.versions.map(id=><li key={id}>{id}</li>)}</ul>:<p>No versions.</p>}</>
}
const fieldValue=(input:unknown)=>typeof input==='string'?input:JSON.stringify(input)
export function PreviewRecords({state,patches}:{state:LocketState;patches:ErasurePatch[]}){
 return <div><h3>Records to minimize</h3><p>Current personal values are masked. Each record and changed field is listed below.</p>{patches.length?<ul>{patches.map(p=><li key={`${p.table}:${p.id}`}>
  <strong>{words(p.table.replace(/^lk_/,''))}</strong> · {p.id}<AgreementReference state={state} id={p.agreementId}/>
  <dl>{Object.entries(p.after).map(([field,after])=><div key={field}><dt>{words(field)}</dt><dd>Before: {fieldValue(p.before[field])}<br/>After: {fieldValue(after)}</dd></div>)}</dl>
 </li>)}</ul>:<p>No current records will be minimized.</p>}</div>
}
