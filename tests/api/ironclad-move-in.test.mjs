import {importedInheritance} from './ironclad-inheritance-journey.mjs'
import {sourceControls} from './ironclad-controls-journey.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { installation } from './harness.mjs'
import { file, zip } from './files.mjs'
import { ironcladArchive, reviewedMapping, ironcladEdge, entity, passage } from '../fixtures/ironclad/archive.mjs'

// Compare every material native field while normalizing destination-generated IDs.
const material=s=>s.agreements.map(a=>({source:s.artifacts.find(f=>f.agreement_id===a.id).source_id,title:a.title,type:a.type,status:a.status,party:s.parties.find(p=>p.id===a.party_id)?.name,entity:s.entities.find(e=>e.id===a.entity_id)?.legal_name,zone:a.timezone,value:a.value_cents,parent:a.parent_id?s.artifacts.find(f=>f.agreement_id===a.parent_id)?.source_id??null:null,relation:a.relation,terms:s.terms.filter(t=>t.agreement_id===a.id).map(t=>[t.key.startsWith('custom:')?s.customFields.find(f=>f.id===t.key.slice(7))?.name:t.key,t.value,t.status]).sort(),custom:s.customValues.filter(v=>v.agreement_id===a.id).map(v=>[s.customFields.find(f=>f.id===v.field_id)?.name,v.value]).sort(),execution:s.executions.filter(e=>e.agreement_id===a.id).map(e=>[e.provider,e.imported,e.status,e.certificate_artifact_id]),files:s.artifacts.filter(f=>f.agreement_id===a.id).map(f=>[f.filename,f.role,f.sha256,f.size,f.imported,JSON.parse(f.provenance).workflowId]).sort()})).sort((a,b)=>a.source.localeCompare(b.source))
function assertCustody(archive,id,expected){
 const journal=archive.importJournal.find(j=>j.batchId===id);assert.ok(journal)
 for(const [name,bytes]of expected){const o=journal.originals.find(o=>o.kind==='artifact'&&o.name===name);assert.ok(o,name);assert.equal(o.sha256,sha(bytes));assert.equal(o.size,bytes.length);assert.deepEqual(Buffer.from(o.original.base64,'base64'),bytes)}
}
async function assertAudit(h,state,archive,actions){
 const actor=state.actor
 const rows=(await(await h.owner.request('/api/locket/audit?person='+actor.id)).json()).rows
 for(const action of actions){const events=rows.filter(r=>r.action===action);assert.ok(events.length,action);assert.ok(events.every(r=>r.actor_id===actor.id&&r.actor_role==='owner'&&r.actor_name&&Number.isFinite(r.at)&&r.command_id));assert.ok(events.every(r=>archive.records.lk_audit.some(a=>a.id===r.id)))}
 for(const a of state.agreements)assert.ok(rows.some(r=>r.action==='import.agreement'&&r.agreement_id===a.id))
 for(const f of state.artifacts.filter(f=>f.agreement_id)){assert.ok(rows.some(r=>r.action==='file.download'&&r.summary.includes(f.id)),'Downloaded original has an audit event');assert.ok(rows.some(r=>r.action==='file.download'&&r.agreement_id===f.agreement_id&&r.summary.includes(f.id)&&r.summary.includes(f.sha256)))}
 const csv=await h.owner.request('/api/locket/audit?format=csv&action=import.apply');assert.equal(csv.status,200);assert.match(await csv.text(),/import.apply/)
}
const sha = b => createHash('sha256').update(b).digest('hex')
const clock = Date.parse('2026-10-29T12:00:00Z')
const batch = (s,id)=>s.imports.find(b=>b.id===id)
const apply = async (owner,id)=>{let result;do{const b=batch(await owner.state(),id);result=await owner.command('import.apply',{batchId:b.id,version:b.version,fingerprint:b.fingerprint})}while(result.status==='applying');return result}
const undo = async (owner,id,opts)=>{let result;do{const b=batch(await owner.state(),id);result=await owner.command('import.undo',{batchId:b.id,version:b.version,reason:'Reviewed unused source batch'},opts)}while(result.status==='undoing');return result}

test('MOVE-002 moves fifty Ironclad records through exports and the pending/ready API, preserves originals, families and cited current-term controls, and undoes only unused batches',async t=>{
  const fixture=ironcladArchive(),edge=ironcladEdge(fixture),calendarEvents=[]
  const h=await installation({bindings:{TEST_NOW:String(clock),IRONCLAD_API_TOKEN:'synthetic-ironclad-read-token',IRONCLAD_REGION:'demo'},outboundResponse:async request=>{if(new URL(request.url).hostname==='www.googleapis.com'){const body=await request.json();calendarEvents.push(body);return Response.json(body)}return edge.respond(request)}});t.after(()=>h.close())
  const e=(await h.owner.command('entity.save',entity)).id
  const viewer=await h.invite('ironclad-viewer@example.test','viewer')
  await viewer.command('import.inspect',fixture.payload,{error:'FORBIDDEN'})
  const catalogue=await h.owner.command('import.inspect',fixture.payload)
  assert.equal(catalogue.records,50);assert.equal(catalogue.files,52)
  assert.deepEqual(catalogue.unmapped,['Business Unit','Cost Center','Legacy Flag'])
  await h.owner.command('import.preview',fixture.payload,{error:'ENTITY_REQUIRED'})
  await h.owner.command('import.preview',{...fixture.payload,entityId:e},{error:'IRONCLAD_MAPPING'})
  const field=(await h.owner.command('field.save',{name:'Imported business unit',kind:'text',agreementTypes:['customer','supplier','nda','amendment','order_form','other'],requiredStages:[],editRoles:['owner','counsel'],options:[]})).id
  const mapping=reviewedMapping(catalogue,field)
  // Same public parser for all documented metadata formats and a combined ZIP.
  let earlierReview,canonicalRows
  for(const manifest of [file('records.json',Buffer.from(JSON.stringify({list:fixture.apiRecords}))),file('records.xlsx',fixture.xlsx)]){
    const inspected=await h.owner.command('import.inspect',{...fixture.payload,manifest})
    assert.deepEqual(inspected.unmapped,catalogue.unmapped);assert.equal(inspected.records,50)
    const reviewed=await h.owner.command('import.preview',{...fixture.payload,manifest,entityId:e,mapping})
    earlierReview=reviewed
    assert.equal(reviewed.counts.import,50)
    const review=JSON.parse(batch(await h.owner.state(),reviewed.batchId).preview)
    const compared=review.rows.map(({row,recordId,workflowId,subject,status,type,counterparty,parentId,relation,document,schedules,outcome,proposedTerms})=>({row,recordId,workflowId,subject,type,counterparty,parentId,relation,document,schedules,outcome,proposedTerms:proposedTerms.sort((a,b)=>a.key.localeCompare(b.key))}))
    if(canonicalRows)assert.deepEqual(compared,canonicalRows);else canonicalRows=compared
    const metadata=await h.owner.command('import.preview',{kit:'ironclad-records',label:'Metadata only '+manifest.filename,manifest,entityId:e,mapping})
    assert.equal(metadata.counts.missing,50);assert.equal(metadata.counts.import,0)
    assert.ok(review.rows.every(r=>r.proposedTerms.some(t=>t.key==='end_date'&&t.value==='2023-02-28')))
  }
  await h.owner.command('field.save',{id:field,version:1,name:'Imported business unit',kind:'text',agreementTypes:['customer','supplier','nda','amendment','order_form','other'],requiredStages:[],editRoles:['owner','counsel'],options:[],helpText:'Review against the current source.'})
  const staleReview=batch(await h.owner.state(),earlierReview.batchId)
  await h.owner.command('import.apply',{batchId:staleReview.id,version:staleReview.version,fingerprint:staleReview.fingerprint},{error:'STALE'})
  const alone=await h.owner.command('import.preview',{kit:'ironclad-records',label:'Metadata only',manifest:fixture.payload.manifest,entityId:e,mapping})
  assert.equal(alone.counts.missing,50);assert.equal(alone.counts.import,0)
  const attachments=await h.owner.command('import.inspect',{label:'Attachments alone',archive:fixture.payload.archive})
  assert.equal(attachments.records,0);assert.equal(attachments.files,52)
  const zipOnly=await h.owner.command('import.preview',{kit:'ironclad-records',label:'ZIP only',archive:fixture.payload.archive,entityId:e,mapping:{types:{},properties:{}}})
  assert.equal(zipOnly.counts.import,0);assert.equal(zipOnly.counts.orphanFiles,52)
  const combined=zip([['records.json',Buffer.from(JSON.stringify(fixture.records))],...fixture.entries])
  assert.equal((await h.owner.command('import.inspect',{label:'Combined ZIP',archive:file('combined.zip',combined)})).records,50)
  const p=await h.owner.command('import.preview',{...fixture.payload,entityId:e,mapping})
  assert.equal(p.counts.import,50);assert.equal(p.counts.orphanFiles,1)
  let s=await h.owner.state(),b=batch(s,p.batchId),summary=JSON.parse(b.preview)
  assert.equal(s.agreements.length,0);assert.equal(summary.mapping.types['Master Services Agreement'],'supplier')
  assert.deepEqual(summary.orphans,['unmatched/extra.pdf'])
  await h.owner.command('import.apply',{batchId:b.id,version:b.version,fingerprint:'changed'},{error:'FINGERPRINT'})
  await apply(h.owner,p.batchId)
  s=await h.owner.state();assert.equal(s.agreements.length,50);assert.equal(s.renewals.length,0)
  assert.ok(s.agreements.every(a=>a.entity_id===e&&a.timezone==='America/New_York'&&a.value_cents===null&&a.status==='imported'))
  assert.ok(s.executions.every(x=>x.imported===1&&x.provider==='ironclad'&&x.status==='needs_review'))
  assert.equal(s.agreements.filter(a=>a.parent_id).length,8)
  assert.equal(s.agreements.filter(a=>a.relation==='amends').length,2)
  assert.equal(s.agreements.filter(a=>a.relation==='order_under').length,6)
  assert.equal(s.customValues.length,50)
  assert.ok(s.terms.every(t=>t.status==='proposed'))
  for(const r of fixture.records){
    const result=await(await h.owner.request('/api/locket/search?q='+r.id)).json();assert.equal(result.results.length,1)
    const byWorkflow=await(await h.owner.request('/api/locket/search?q='+r.workflowId)).json();assert.equal(byWorkflow.results.length,1)
    const a=s.artifacts.find(a=>a.source_id===r.id),original=fixture.documents.find(([path])=>path.startsWith(r.id+'/'))[1]
    const bytes=Buffer.from(await(await h.owner.request('/api/locket/files/'+a.id)).arrayBuffer())
    assert.deepEqual(bytes,original);assert.equal(a.sha256,sha(original))
  }
  for(const [path,original] of fixture.documents){const f=s.artifacts.find(f=>JSON.parse(f.provenance).path===path);assert.ok(f);const response=await h.owner.request('/api/locket/files/'+f.id);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),original);assert.equal(f.sha256,sha(original))}
  const fileState=s
  const unchanged=JSON.stringify({agreements:s.agreements,artifacts:s.artifacts.filter(r=>r.agreement_id),terms:s.terms,executions:s.executions})
  const duplicate=await h.owner.command('import.preview',{...fixture.payload,entityId:e,mapping})
  assert.equal(duplicate.counts.import,0);assert.equal(duplicate.counts.duplicate,50)
  assert.equal(JSON.stringify((({agreements,artifacts,terms,executions})=>({agreements,artifacts:artifacts.filter(r=>r.agreement_id),terms,executions}))(await h.owner.state())),unchanged)
  const roots=s.agreements.filter(a=>a.type==='supplier')
  for(const a of roots){
    const terms=s.terms.filter(t=>t.agreement_id===a.id)
    await h.owner.command('term.decide',{agreementId:a.id,termId:terms[0].id,decision:'confirm'},{error:'INVALID'})
    for(const term of terms)await h.owner.command('term.decide',{agreementId:a.id,termId:term.id,decision:'confirm',citation:{quote:passage,page:1}})
    for(const [key,value]of [['governing_law','New York'],['payment_terms','Net 30']]){const t=await h.owner.command('term.propose',{agreementId:a.id,key,value,citation:{quote:passage,page:1}});await h.owner.command('term.decide',{agreementId:a.id,termId:t.id,decision:'confirm'})}
  }
  s=await h.owner.state()
  assert.ok(roots.every(a=>s.agreements.find(r=>r.id===a.id).value_cents===1000000))
  const reminder=await h.owner.command('renewal.bulk.preview',{agreementIds:s.agreements.map(a=>a.id),ownerId:s.actor.id,offsets:[90,60,30,7]})
  assert.equal(reminder.tracked.length,2);assert.equal(reminder.skipped.length,48)
  assert.ok(reminder.tracked.every(r=>r.end==='2027-02-28'&&r.deadlineDate==='2026-12-30'&&r.term===5))
  await h.owner.command('renewal.bulk.apply',{previewId:reminder.id})
  assert.equal((await h.owner.state()).reminderSchedules.length,2)
  await importedInheritance(h,{roots,viewer,clock,calendarEvents})
  const term=s.terms.find(t=>t.agreement_id===roots[0].id&&t.key==='end_date'&&t.status==='confirmed')
  await viewer.command('family.term',{agreementId:roots[0].id,termId:term.id},{error:'FORBIDDEN'})
  await h.owner.command('family.term',{agreementId:roots[0].id,version:(await h.owner.state()).agreements.find(a=>a.id===roots[0].id).version,termId:term.id})
  const family=await(await h.owner.request('/api/locket/families/'+roots[0].id)).json()
  assert.equal(family.members.length,5);assert.equal(family.governing[0].stale,false)
  const replacement=await h.owner.command('term.propose',{agreementId:roots[0].id,key:'end_date',value:'2024-02-28',citation:{quote:passage,page:1}})
  await h.owner.command('term.decide',{agreementId:roots[0].id,termId:replacement.id,decision:'confirm'})
  assert.equal((await(await h.owner.request('/api/locket/families/'+roots[0].id)).json()).governing[0].stale,true)
  await undo(h.owner,p.batchId,{error:'IMPORT_DEPENDENCY'})
  const archive=await(await h.owner.request('/api/locket/export')).json()
  assert.equal(archive.records.lk_import_batches.find(b=>b.id===p.batchId).status,'applied')
  assertCustody(archive,p.batchId,[['records.csv',Buffer.from(fixture.csv)],['attachments.zip',fixture.archive],...fixture.entries])
  assertCustody(archive,alone.batchId,[['records.csv',Buffer.from(fixture.csv)]])
  assertCustody(archive,duplicate.batchId,[['records.csv',Buffer.from(fixture.csv)],['attachments.zip',fixture.archive],...fixture.entries])
  assert.equal(archive.files.filter(a=>a.source_system==='ironclad').length,51)
  // A fresh destination exercises the same fixture through the real API adapter.
  const apiEdge=ironcladEdge(fixture),a=await installation({bindings:{TEST_NOW:String(clock),IRONCLAD_API_TOKEN:'synthetic-ironclad-read-token',IRONCLAD_REGION:'demo'},outboundResponse:apiEdge.respond});t.after(()=>a.close())
  await a.owner.command('import.ironclad.start',{label:'API records'},{error:'CONSENT'})
  const read=await a.owner.command('import.ironclad.start',{label:'API records',consent:true})
  let job=(await a.owner.state()).ironcladReads.find(r=>r.id===read.id)
  let polled=await a.owner.command('import.ironclad.poll',{id:job.id,version:job.version});assert.equal(polled.status,'pending');assert.equal(polled.input,null)
  polled=await a.owner.command('import.ironclad.poll',{id:job.id,version:polled.version});assert.equal(polled.status,'ready')
  const apiViewer=await a.invite('ironclad-api-viewer@example.test','viewer')
  const rawSources=(await a.owner.state()).artifacts.filter(r=>r.source_system==='ironclad-api')
  assert.equal(rawSources.length,2)
  assert.ok(!(await apiViewer.state()).artifacts.some(r=>r.source_system==='ironclad-api'))
  for(const source of rawSources)assert.equal((await apiViewer.request('/api/locket/files/'+source.id)).status,404)
  const apiEntity=(await a.owner.command('entity.save',entity)).id
  const apiField=(await a.owner.command('field.save',{name:'Imported business unit',kind:'text',agreementTypes:['customer','supplier','nda','amendment','order_form','other'],requiredStages:[],editRoles:['owner','counsel'],options:[]})).id
  const apiCatalogue=await a.owner.command('import.inspect',polled.input),apiMapping=reviewedMapping(apiCatalogue,apiField)
  const apiPreview=await a.owner.command('import.preview',{...polled.input,kit:'ironclad-records',mapping:apiMapping,entityId:apiEntity})
  assert.equal(apiPreview.counts.import,50);assert.deepEqual({...apiPreview.counts,orphanFiles:1},p.counts)
  await apply(a.owner,apiPreview.batchId)
  const apiState=await a.owner.state()
  assert.deepEqual(apiState.agreements.map(r=>r.title).sort(),s.agreements.map(r=>r.title).sort())
  assert.deepEqual(apiState.artifacts.filter(r=>r.source_system==='ironclad').map(r=>r.sha256).sort(),s.artifacts.filter(r=>r.source_system==='ironclad').map(r=>r.sha256).sort())
  assert.equal(apiState.agreements.filter(r=>r.parent_id).length,8)
  assert.deepEqual(material(apiState),material(fileState))
  for(const f of apiState.artifacts.filter(f=>f.agreement_id)){const response=await a.owner.request('/api/locket/files/'+f.id);assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(sha(bytes),f.sha256);assert.deepEqual(bytes,fixture.documents.find(([path])=>path===JSON.parse(f.provenance).path)[1])}
  await undo(a.owner,apiPreview.batchId)
  const undone=await a.owner.state();assert.equal(undone.agreements.length,0);assert.equal(undone.artifacts.filter(r=>r.agreement_id).length,0);assert.equal(undone.parties.length,0)
  assert.equal(batch(undone,apiPreview.batchId).status,'undone')
  assert.equal(undone.customValues.length,0)
  const retained=await(await a.owner.request('/api/locket/export')).json()
  assertCustody(retained,apiPreview.batchId,[['records.json',Buffer.from(polled.input.manifest.base64,'base64')],...fixture.documents])
  await assertAudit(a,apiState,retained,['import.ironclad.start','import.ironclad.poll','import.inspect','import.preview','import.apply','import.undo','import.journal.export'])
  await assertAudit(h,fileState,archive,['import.inspect','import.preview','import.apply','import.journal.export'])
  assert.equal(retained.records.lk_ironclad_reads.length,1);assert.ok(!('session_id' in retained.records.lk_ironclad_reads[0]))
  assert.equal(apiEdge.calls.filter(r=>r.path.endsWith('/records')).length,2)
  const rootsOnly=fixture.records.filter(r=>r.recordType==='Master Services Agreement')
  const parents=await a.owner.command('import.preview',{...fixture.payload,manifest:file('records.json',Buffer.from(JSON.stringify(rootsOnly))),mapping:apiMapping,entityId:apiEntity})
  assert.equal(parents.counts.import,2);await apply(a.owner,parents.batchId)
  const children=await a.owner.command('import.preview',{...fixture.payload,manifest:file('records.json',Buffer.from(JSON.stringify(fixture.records.filter(r=>!rootsOnly.includes(r))))),mapping:apiMapping,entityId:apiEntity})
  assert.equal(children.counts.import,48);await apply(a.owner,children.batchId)
  assert.equal((await a.owner.state()).agreements.filter(r=>r.parent_id).length,8)
  await undo(a.owner,parents.batchId,{error:'IMPORT_DEPENDENCY'})
  await undo(a.owner,children.batchId);await undo(a.owner,parents.batchId)
  assert.equal((await a.owner.state()).agreements.length,0)

  // Read failures stay visible, current consent cannot cross owner sessions, and
  // malformed source graphs never produce native agreements.
  const cycle=structuredClone(fixture.records);cycle[0].parentId=cycle[1].id
  await a.owner.command('import.preview',{...fixture.payload,manifest:file('records.json',Buffer.from(JSON.stringify(cycle))),mapping:apiMapping,entityId:apiEntity},{error:'IRONCLAD_FAMILY'})
  await sourceControls(a,{entityId:apiEntity,apply,undo})
  const failureEdge=ironcladEdge(ironcladArchive({count:2}),{failJob:true})
  const f=await installation({bindings:{IRONCLAD_API_TOKEN:'synthetic-ironclad-read-token',IRONCLAD_REGION:'demo'},outboundResponse:failureEdge.respond});t.after(()=>f.close())
  const started=await f.owner.command('import.ironclad.start',{label:'Visible failed read',consent:true})
  const failed=await f.owner.command('import.ironclad.poll',{id:started.id,version:1})
  assert.equal(failed.status,'pending');assert.match(failed.message,/HTTP 503/)
  assert.equal((await f.owner.state()).agreements.length,0)
  failureEdge.setFailure(false,true)
  const processing=await f.owner.command('import.ironclad.poll',{id:started.id,version:failed.version})
  const partial=await f.owner.command('import.ironclad.poll',{id:started.id,version:processing.version})
  assert.equal(partial.status,'failed');assert.equal(partial.input,null);assert.match(partial.message,/ACCESS_DENIED/);assert.equal((await f.owner.state()).agreements.length,0)
  const newLogin=await f.signIn('owner@example.test')
  await newLogin.command('import.ironclad.poll',{id:started.id,version:partial.version},{error:'NOT_FOUND'})
  const failures=await f.owner.state();assert.match(failures.ironcladReads[0].message,/ACCESS_DENIED/)

})
