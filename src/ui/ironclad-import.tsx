import { useState } from 'react'
import { fileToPayload, type LocketState } from './api'
import type { Locket } from './app'
import { Badge, Field, Form, value } from './controls'
import { EntitySelect } from './entities'

const types = ['customer','supplier','nda','amendment','order_form','other']
const targets = ['title','counterparty','effective_date','end_date','renewal_type','renewal_term_months','renewals_allowed','notice_days','governing_law','payment_terms','value']
const label = (s: string) => s.replaceAll('_',' ')

export function IroncladImport({state,locket,onPreview}:{state:LocketState;locket:Locket;onPreview:(id:string)=>void}) {
  const [source,setSource]=useState('export'),[input,setInput]=useState<any>(null),[catalogue,setCatalogue]=useState<any>(null),[mapping,setMapping]=useState<any>(null)
  const [entityId,setEntityId]=useState(state.entities[0]?.id??'')
  const [relations,setRelations]=useState<Record<string,string>>({})
  const inspect=async(payload:any)=>{
    const result=await locket.run('import.inspect',payload)
    if(result){setInput(payload);setCatalogue(result);setMapping(result.mapping);setRelations(Object.fromEntries(result.families.map((r:any)=>[r.recordId,r.relation||(result.mapping.types[r.type]==='amendment'?'amends':result.mapping.types[r.type]==='order_form'?'order_under':'schedule_to')])))}
  }
  return <>
    <p>Import completed repository records. Review mappings first; dates and USD values remain proposed until cited and confirmed. Active workflows and clickwrap use separate kits.</p>
    <Field label="Ironclad source"><select value={source} onChange={e=>setSource(e.target.value)}><option value="export">Metadata export and attachments ZIP</option><option value="api">Records API</option></select></Field>
    {source==='export'?<Form busy={locket.busy} submit="Inspect Ironclad source" onSubmit={async data=>{
      const manifest=data.get('manifest') as File,archive=data.get('archive') as File
      if(!manifest?.size&&!archive?.size)return locket.setError('Choose a metadata export or attachments ZIP.')
      const selected=value(data,'entityId');setEntityId(selected)
      await inspect({label:value(data,'label'),...(selected?{entityId:selected}:{}),...(manifest?.size?{manifest:await fileToPayload(manifest)}:{}),...(archive?.size?{archive:await fileToPayload(archive)}:{})})
    }}>
      {state.entities.length>0&&<EntitySelect state={state}/>}
      <Field label="Batch name"><input name="label" required placeholder="Ironclad repository at cutover"/></Field>
      <Field label="Repository metadata" hint="Export all original columns from Dashboard or Imports. CSV, JSON or XLSX; at most 250 records and 6 MB per batch including expanded files."><input name="manifest" type="file" accept=".csv,.json,.jsonl,.xlsx"/></Field>
      <Field label="Attachments ZIP" hint="Keep the exported record folders and filenames. A combined ZIP may include records.json, records.csv or records.xlsx. Unmatched files remain in the journal."><input name="archive" type="file" accept=".zip"/></Field>
    </Form>:<>
      <Form busy={locket.busy} submit="Read Ironclad records" onSubmit={async data=>{
        setEntityId(value(data,'entityId'))
        await locket.run('import.ironclad.start',{label:value(data,'label'),consent:data.get('consent')==='on'})
      }}>
        {state.entities.length>0&&<EntitySelect state={state}/>}
        <Field label="Batch name"><input name="label" required/></Field>
        <p className="lk-muted">The private installation connection supplies the API credential. Reading creates no Locket agreement. Attachment preparation may take several checks.</p>
        <label className="lk-check"><input name="consent" type="checkbox" required/>I authorize reading this Ironclad repository and its original documents.</label>
      </Form>
      <ul className="lk-pick-list">{state.ironcladReads.map(r=><li key={r.id}><strong>{r.label}</strong> <Badge value={r.status}/><p>{r.message??'Attachment job requested; no agreements imported.'}</p>{r.status!=='failed'&&<button type="button" disabled={locket.busy} onClick={async()=>{
        const result=await locket.run('import.ironclad.poll',{id:r.id,version:r.version})
        if(result?.input)await inspect({...result.input,...(entityId?{entityId}: {})})
      }}>{r.status==='ready'?'Review downloaded source':'Check attachment job'}</button>}</li>)}</ul>
    </>}
    {catalogue&&mapping&&<section aria-label="Ironclad mapping" className="lk-import-mapping">
      <h3>Review the mapping</h3><p>{catalogue.records} records · {catalogue.files} supplied files. Every unmapped property needs a destination or an explicit skip.</p>
      {catalogue.unmapped.length>0&&<p className="lk-warning">Initially unmapped: {catalogue.unmapped.join(', ')}.</p>}
      <Form busy={locket.busy} submit="Review Ironclad dry run" onSubmit={async()=>{
        const result=await locket.run('import.preview',{...input,kit:'ironclad-records',mapping,relations})
        if(result)onPreview(result.batchId)
      }}>
        <fieldset className="lk-fieldset"><legend>Record types</legend>{catalogue.types.map((t:string)=><Field key={t} label={`Record type: ${t}`}><select value={mapping.types[t]} onChange={e=>setMapping({...mapping,types:{...mapping.types,[t]:e.target.value}})}>{types.map(v=><option key={v} value={v}>{label(v)}</option>)}</select></Field>)}</fieldset>
        <fieldset className="lk-fieldset"><legend>Properties</legend>{catalogue.properties.map((property:string)=><div key={property}>
          <Field label={`Property: ${property}`}><select value={mapping.properties[property]} onChange={e=>setMapping({...mapping,properties:{...mapping.properties,[property]:e.target.value}})}>
            <option value="unmapped">Choose a destination</option><option value="skip">Skip explicitly (original retained)</option>
            {targets.map(v=><option key={v} value={v}>{v==='value'?'Proposed contract value (USD)':label(v)}</option>)}
            {state.customFields.map(f=><option key={f.id} value={`custom:${f.id}`}>{f.name} (custom {label(f.kind)})</option>)}
          </select></Field>
          {mapping.properties[property]==='unmapped'&&<button type="button" className="lk-small" disabled={locket.busy} onClick={async()=>{
            const field=await locket.run('field.save',{name:property,kind:'text',agreementTypes:types,requiredStages:[],editRoles:['owner','counsel'],options:[]})
            if(field)setMapping((m:any)=>({...m,properties:{...m.properties,[property]:`custom:${field.id}`}}))
          }}>Create custom text field for {property}</button>}
        </div>)}</fieldset>
        {catalogue.families.length>0&&<fieldset className="lk-fieldset"><legend>Family relations</legend>{catalogue.families.map((r:any)=><Field key={r.recordId} label={`Relation: ${r.recordId}`} hint={`Parent record ${r.parentId}. This links documents; it never chooses governing terms.`}><select value={relations[r.recordId]} onChange={e=>setRelations({...relations,[r.recordId]:e.target.value})}>{['amends','order_under','schedule_to','renews','statement_of_work_under','supersedes'].map(v=><option key={v} value={v}>{label(v)}</option>)}</select></Field>)}</fieldset>}
      </Form>
    </section>}
  </>
}
