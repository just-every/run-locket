import { useState } from 'react'
import { fileToPayload, type LocketState } from './api'
import type { Locket } from './app'
import { Badge, Field, Form, value } from './controls'
import { EntitySelect } from './entities'
import { plural } from './format'

export async function runImportOperation(locket:Locket,type:string,batch:any,extra:Record<string,unknown>={}) {
  let version=batch.version
  for(let n=0;n<30;n++){const result=await locket.run(type,{batchId:batch.id,version,...extra});if(!result||!['applying','undoing'].includes(result.status))return;version=result.version}
  locket.setError('The journal saved progress. Use the same action to resume.')
}
const targets = ['id','code','title','type','status','counterparty','parent','relation','documents','effective_date','end_date','auto_renew','renewal_type','initial_term_months','renewal_term_months','renewals_allowed','notice_days','governing_law','payment_terms','value','currency']
const types = ['customer','supplier','nda','amendment','order_form','other']
const label = (s: string) => s.replaceAll('_',' ').replace(/^./, c=>c.toUpperCase())
export function EnterpriseImport({ state, locket, selected }: { state: LocketState; locket: Locket; selected: (id: string)=>void }) {
  const [source, setSource] = useState('export')
  return <section className="lk-panel"><div className="lk-panel-head"><h2>Move from Icertis or Agiloft</h2></div>
    <p>Review column and contract-type mappings before applying. Dates, amounts and custom fields stay proposed until a person checks the signed document.</p>
    <Form busy={locket.busy} submit="Review source" onSubmit={async data=>{
      const kit=value(data,'kit'), manifest=data.get('manifest') as File|null
      const files=(data.getAll('files') as File[]).filter(f=>f.size)
      if(source==='export'&&!manifest?.size)return locket.setError('Choose the metadata export.')
      const result=await locket.run('import.preview',{kit,label:value(data,'label'),source,consent:data.get('consent')==='on',restricted:data.get('restricted')==='on',...(state.entities.length?{entityId:value(data,'entityId')} : {}),dateFormat:'iso',...(manifest?.size?{manifest:await fileToPayload(manifest)}:{}),files:await Promise.all(files.map(async f=>{const path=(f as File&{webkitRelativePath?:string}).webkitRelativePath||f.name;return {path:path.split('/').length>2?path.split('/').slice(1).join('/'):path,base64:(await fileToPayload(f)).base64}}))})
      if(result)selected(result.batchId)
    }}>
      <Field label="Source system"><select name="kit"><option value="icertis">Icertis Contract Intelligence</option><option value="agiloft">Agiloft</option></select></Field>
      <Field label="Enterprise batch name"><input name="label" required /></Field>
      {state.entities.length>0&&<EntitySelect state={state}/>}
      <Field label="Read from"><select name="source" value={source} onChange={e=>setSource(e.target.value)}><option value="export">Metadata export and documents folder</option><option value="api">Configured read-only API</option></select></Field>
      <Field label="Metadata export (XLSX or CSV)" hint={source==='api'?'Optional: combine an export with the API snapshot.':undefined}><input name="manifest" type="file" accept=".xlsx,.csv" required={source==='export'}/></Field><Field label="Documents folder" hint="Folders named by source ID or ICI agreement code. Keep every original file."><input name="files" type="file" multiple {...{webkitdirectory:''}}/></Field>
      {source==='api'&&<><p className="lk-muted">The installation must have a private read credential and a tenant-documented API profile. API responses and documents enter the same review journal.</p><Field label="Authorize this read-only import"><input name="consent" type="checkbox" required/></Field></>}
      <Field label="Restrict imported agreements" hint="Only Locket’s full readers and people granted access in Locket can see restricted agreements. Source-system permissions are not imported."><input name="restricted" type="checkbox"/></Field>
    </Form>
  </section>
}
export function EnterprisePreview({ state, locket, batch, preview, selected }: { state:LocketState;locket:Locket;batch:any;preview:any;selected:(id:string)=>void }) {
  const fileFields=[...new Set<string>(preview.rows.flatMap((r:any)=>r.documents.map((d:any)=>d.path.split('/')[1])))]
  const filePaths=[...new Set<string>(preview.rows.flatMap((r:any)=>r.documents.map((d:any)=>d.path)))]
  return <>
    <p>{preview.counts.rows} source records · {preview.counts.import} to import · {preview.counts.missing} missing evidence · {preview.counts.duplicate} duplicates · {preview.counts.skip} unsigned or skipped</p>
    {preview.missingMappings?.length>0&&<p className="lk-warning">Choose required source mappings: {preview.missingMappings.join(', ')}.</p>}
    {preview.unmapped.length>0&&<p className="lk-warning">Unmapped fields: {preview.unmapped.join(', ')}. Choose a field, create one in Library, or explicitly skip it; then review a new dry run.</p>}
    {batch.status==='previewed'&&batch.version===1&&<details className="lk-disclosure" open={preview.unmapped.length>0}><summary>Review mappings</summary>
      <Form busy={locket.busy} submit="Review revised mapping" onSubmit={async data=>{
        const mapping=Object.fromEntries(preview.manifest.columns.map((c:string)=>[c,value(data,'column:'+c)]))
        const typeMapping=Object.fromEntries(Object.keys(preview.typeMapping).map(c=>[c,value(data,'type:'+c)]))
        const fileRoles=Object.fromEntries([...fileFields.map(field=>[field,value(data,'role:'+field)]),...filePaths.map(path=>[path,value(data,'file:'+path)]).filter(([,role])=>role)])
        const result=await locket.run('import.remap',{batchId:batch.id,version:batch.version,mapping,typeMapping,fileRoles,signedStatuses:value(data,'signedStatuses').split(',').map(s=>s.trim()).filter(Boolean)})
        if(result)selected(result.batchId)
      }}>
        {preview.manifest.columns.map((column:string)=><Field key={column} label={'Map '+column}><select name={'column:'+column} defaultValue={preview.mapping[column]}><option value="unmapped">Unmapped — review required</option><option value="skip">Skip explicitly</option>{targets.map(t=><option key={t} value={t}>{label(t)}</option>)}{state.customFields.map(f=><option key={f.id} value={'custom:'+f.id}>{f.name} (custom)</option>)}</select></Field>)}
        {Object.entries(preview.typeMapping).map(([source,target])=><Field key={source} label={'Contract type '+source}><select name={'type:'+source} defaultValue={String(target)}><option value="">Choose type</option>{types.map(t=><option key={t} value={t}>{label(t)}</option>)}</select></Field>)}
        <Field label="Source statuses explicitly marked signed" hint="Only these comma-separated statuses create imported execution history. Other statuses are skipped."><input name="signedStatuses" required defaultValue={preview.signedStatuses.join(', ')}/></Field>
        <p className="lk-muted">Choose the signed copy explicitly. A source version is never treated as signed just because it is the first PDF.</p>
        {fileFields.map(field=><Field key={field} label={'Documents in '+field}><select name={'role:'+field} defaultValue={preview.fileRoles[field]??'version'}><option value="signed">Signed agreement</option><option value="version">Source version</option><option value="attachment">Supporting file</option><option value="certificate">Provider certificate</option></select></Field>)}
        <details className="lk-disclosure"><summary>Override individual file roles</summary>{filePaths.map(path=><Field key={path} label={'File role '+path}><select name={'file:'+path} defaultValue={preview.fileRoles[path]??''}><option value="">Use folder mapping</option><option value="signed">Signed agreement</option><option value="version">Source version</option><option value="attachment">Supporting file</option><option value="certificate">Provider certificate</option></select></Field>)}</details>
      </Form>
    </details>}
    {preview.orphans.length>0&&<p className="lk-warning">Files without records: {preview.orphans.join(', ')}</p>}
    <div className="lk-table-wrap"><table className="lk-table"><thead><tr><th>Source record</th><th>Agreement</th><th>Files and proposed values</th><th>Outcome</th></tr></thead><tbody>{preview.rows.map((r:any)=><tr key={r.row}><td data-label="Source record">{r.sourceId||`Row ${r.row}`}<small>{r.code}</small></td><td data-label="Agreement">{r.subject}<small>{r.counterparty} · {label(r.type)}</small>{r.parentSourceId&&<small>{r.relation}: {r.parentSourceId}</small>}</td><td data-label="Files and proposed values"><details><summary>{r.documents.length} files · {r.proposed.length} proposed values</summary>{r.documents.map((d:any)=><small key={d.path}>{d.path} · {d.role} · SHA-256 {d.sha256}</small>)}{r.proposed.map((t:any)=><small key={t.key}>{label(t.key)}: {t.value} (proposed)</small>)}</details></td><td data-label="Outcome"><Badge value={r.outcome}/>{r.notes.map((n:string)=><small key={n}>{n}</small>)}</td></tr>)}</tbody></table></div>
    {batch.status==='previewed'&&batch.version>1&&<p role="status">This reviewed import has saved progress. Apply the same dry run to resume; its mapping is fixed.</p>}
    <p className="lk-muted">Imported execution history remains labeled imported. Unverified signers and absent certificates stay flagged for review. The journal keeps the metadata export, every supplied file and original API responses.</p>
    {batch.status==='previewed'&&<button type="button" className="lk-primary" disabled={locket.busy||preview.unmapped.length>0||preview.counts.import===0} onClick={()=>void runImportOperation(locket,'import.apply',batch,{fingerprint:batch.fingerprint})}>Apply this dry run ({plural(preview.counts.import,'agreement')})</button>}
  </>
}
