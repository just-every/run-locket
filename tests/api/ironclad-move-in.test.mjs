import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { installation } from './harness.mjs'
import { file, zip } from './files.mjs'
import { ironcladArchive, reviewedMapping, ironcladEdge, entity, passage } from '../fixtures/ironclad/archive.mjs'

const sha = b => createHash('sha256').update(b).digest('hex')
const clock = Date.parse('2026-10-29T12:00:00Z')
const batch = (s,id)=>s.imports.find(b=>b.id===id)
const apply = async (owner,id)=>{let result;do{const b=batch(await owner.state(),id);result=await owner.command('import.apply',{batchId:b.id,version:b.version,fingerprint:b.fingerprint})}while(result.status==='applying');return result}
const undo = async (owner,id,opts)=>{let result;do{const b=batch(await owner.state(),id);result=await owner.command('import.undo',{batchId:b.id,version:b.version,reason:'Reviewed unused source batch'},opts)}while(result.status==='undoing');return result}

test('MOVE-002 moves fifty Ironclad records through exports and the pending/ready API, preserves originals, families and cited current-term controls, and undoes only unused batches',async t=>{
  const fixture=ironcladArchive(),edge=ironcladEdge(fixture)
  const h=await installation({bindings:{TEST_NOW:String(clock),IRONCLAD_API_TOKEN:'synthetic-ironclad-read-token',IRONCLAD_REGION:'demo'},outboundResponse:edge.respond});t.after(()=>h.close())
  const e=(await h.owner.command('entity.save',entity)).id
  const viewer=await h.invite('ironclad-viewer@example.test','viewer')
  await viewer.command('import.inspect',fixture.payload,{error:'FORBIDDEN'})
  const catalogue=await h.owner.command('import.inspect',fixture.payload)
  assert.equal(catalogue.records,50);assert.equal(catalogue.files,51)
  assert.deepEqual(catalogue.unmapped,['Business Unit','Cost Center','Legacy Flag'])
  await h.owner.command('import.preview',fixture.payload,{error:'ENTITY_REQUIRED'})
  await h.owner.command('import.preview',{...fixture.payload,entityId:e},{error:'IRONCLAD_MAPPING'})
  const field=(await h.owner.command('field.save',{name:'Imported business unit',kind:'text',agreementTypes:['customer','supplier','nda','amendment','order_form','other'],requiredStages:[],editRoles:['owner','counsel'],options:[]})).id
  const mapping=reviewedMapping(catalogue,field)
  // Same public parser for all documented metadata formats and a combined ZIP.
  let earlierReview
  for(const manifest of [file('records.json',Buffer.from(JSON.stringify({list:fixture.records}))),file('records.xlsx',fixture.xlsx)]){
    const inspected=await h.owner.command('import.inspect',{...fixture.payload,manifest})
    assert.deepEqual(inspected.unmapped,catalogue.unmapped);assert.equal(inspected.records,50)
    const reviewed=await h.owner.command('import.preview',{...fixture.payload,manifest,entityId:e,mapping})
    earlierReview=reviewed
    assert.equal(reviewed.counts.import,50)
    const review=JSON.parse(batch(await h.owner.state(),reviewed.batchId).preview)
    assert.ok(review.rows.every(r=>r.proposedTerms.some(t=>t.key==='end_date'&&t.value==='2023-02-28')))
  }
  await h.owner.command('field.save',{id:field,version:1,name:'Imported business unit',kind:'text',agreementTypes:['customer','supplier','nda','amendment','order_form','other'],requiredStages:[],editRoles:['owner','counsel'],options:[],helpText:'Review against the current source.'})
  const staleReview=batch(await h.owner.state(),earlierReview.batchId)
  await h.owner.command('import.apply',{batchId:staleReview.id,version:staleReview.version,fingerprint:staleReview.fingerprint},{error:'STALE'})
  const alone=await h.owner.command('import.preview',{kit:'ironclad-records',label:'Metadata only',manifest:fixture.payload.manifest,entityId:e,mapping})
  assert.equal(alone.counts.missing,50);assert.equal(alone.counts.import,0)
  const attachments=await h.owner.command('import.inspect',{label:'Attachments alone',archive:fixture.payload.archive})
  assert.equal(attachments.records,0);assert.equal(attachments.files,51)
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
  const duplicate=await h.owner.command('import.preview',{...fixture.payload,entityId:e,mapping})
  assert.equal(duplicate.counts.import,0);assert.equal(duplicate.counts.duplicate,50)
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
  assert.equal(archive.files.filter(a=>a.source_system==='ironclad').length,50)
  // A fresh destination exercises the same fixture through the real API adapter.
  const apiEdge=ironcladEdge(fixture),a=await installation({bindings:{TEST_NOW:String(clock),IRONCLAD_API_TOKEN:'synthetic-ironclad-read-token',IRONCLAD_REGION:'demo'},outboundResponse:apiEdge.respond});t.after(()=>a.close())
  await a.owner.command('import.ironclad.start',{label:'API records'},{error:'CONSENT'})
  const read=await a.owner.command('import.ironclad.start',{label:'API records',consent:true})
  let job=(await a.owner.state()).ironcladReads.find(r=>r.id===read.id)
  let polled=await a.owner.command('import.ironclad.poll',{id:job.id,version:job.version});assert.equal(polled.status,'pending');assert.equal(polled.input,null)
  polled=await a.owner.command('import.ironclad.poll',{id:job.id,version:polled.version});assert.equal(polled.status,'ready')
  const apiCatalogue=await a.owner.command('import.inspect',polled.input),apiMapping=reviewedMapping(apiCatalogue)
  const apiPreview=await a.owner.command('import.preview',{...polled.input,kit:'ironclad-records',mapping:apiMapping})
  assert.equal(apiPreview.counts.import,50);assert.deepEqual(apiPreview.counts,p.counts)
  await apply(a.owner,apiPreview.batchId)
  const apiState=await a.owner.state()
  assert.deepEqual(apiState.agreements.map(r=>r.title).sort(),s.agreements.map(r=>r.title).sort())
  assert.deepEqual(apiState.artifacts.filter(r=>r.source_system==='ironclad').map(r=>r.sha256).sort(),s.artifacts.filter(r=>r.source_system==='ironclad').map(r=>r.sha256).sort())
  assert.equal(apiState.agreements.filter(r=>r.parent_id).length,8)
  await undo(a.owner,apiPreview.batchId)
  const undone=await a.owner.state();assert.equal(undone.agreements.length,0);assert.equal(undone.artifacts.filter(r=>r.agreement_id).length,0);assert.equal(undone.parties.length,0)
  assert.equal(batch(undone,apiPreview.batchId).status,'undone')
  const retained=await(await a.owner.request('/api/locket/export')).json()
  assert.equal(retained.records.lk_ironclad_reads.length,1);assert.ok(!('session_id' in retained.records.lk_ironclad_reads[0]))
  assert.equal(apiEdge.calls.filter(r=>r.path.endsWith('/records')).length,2)
  const rootsOnly=fixture.records.filter(r=>r.recordType==='Master Services Agreement')
  const parents=await a.owner.command('import.preview',{...fixture.payload,manifest:file('records.json',Buffer.from(JSON.stringify(rootsOnly))),mapping:apiMapping})
  assert.equal(parents.counts.import,2);await apply(a.owner,parents.batchId)
  const children=await a.owner.command('import.preview',{...fixture.payload,manifest:file('records.json',Buffer.from(JSON.stringify(fixture.records.filter(r=>!rootsOnly.includes(r))))),mapping:apiMapping})
  assert.equal(children.counts.import,48);await apply(a.owner,children.batchId)
  assert.equal((await a.owner.state()).agreements.filter(r=>r.parent_id).length,8)
  await undo(a.owner,parents.batchId,{error:'IMPORT_DEPENDENCY'})
  await undo(a.owner,children.batchId);await undo(a.owner,parents.batchId)
  assert.equal((await a.owner.state()).agreements.length,0)

  // Read failures stay visible, current consent cannot cross owner sessions, and
  // malformed source graphs never produce native agreements.
  const cycle=structuredClone(fixture.records);cycle[0].parentId=cycle[1].id
  await a.owner.command('import.preview',{...fixture.payload,manifest:file('records.json',Buffer.from(JSON.stringify(cycle))),mapping:apiMapping},{error:'IRONCLAD_FAMILY'})
  const failureEdge=ironcladEdge(ironcladArchive({count:2}),{failJob:true})
  const f=await installation({bindings:{IRONCLAD_API_TOKEN:'synthetic-ironclad-read-token',IRONCLAD_REGION:'demo'},outboundResponse:failureEdge.respond});t.after(()=>f.close())
  const started=await f.owner.command('import.ironclad.start',{label:'Visible failed read',consent:true})
  const failed=await f.owner.command('import.ironclad.poll',{id:started.id,version:1})
  assert.equal(failed.status,'pending');assert.match(failed.message,/HTTP 503/)
  assert.equal((await f.owner.state()).agreements.length,0)
  const newLogin=await f.signIn('owner@example.test')
  await newLogin.command('import.ironclad.poll',{id:started.id,version:failed.version},{error:'NOT_FOUND'})
  const failures=await f.owner.state();assert.match(failures.ironcladReads[0].message,/HTTP 503/)

})
