import {prepareBulk,applyBulk} from './repository-bulk-fixture.mjs'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {file,pdf} from './files.mjs'
import {ironcladArchive,reviewedMapping,entity,passage} from '../fixtures/ironclad/archive.mjs'
const batch=(s,id)=>s.imports.find(b=>b.id===id)
const payload=(records,files,label='Reviewed source boundaries')=>({kit:'ironclad-records',label,manifest:file('records.json',Buffer.from(JSON.stringify({list:records}))),files:files.map(([path,bytes])=>({path,base64:bytes.toString('base64')}))})
const native=s=>({agreements:s.agreements,executions:s.executions,renewals:s.renewals,terms:s.terms,customValues:s.customValues,files:s.artifacts.filter(f=>f.agreement_id)})
export async function sourceControls(h,{entityId,apply,undo}) {
 const fixture=ironcladArchive({count:2,prefix:'controls',orphan:false}),records=structuredClone(fixture.apiRecords)
 const input=payload(records,fixture.documents),catalogue=await h.owner.command('import.inspect',input),mapping=reviewedMapping(catalogue)
 const preview=async(extra={})=>h.owner.command('import.preview',{...input,entityId,mapping,...extra})
 const applyArgs=async id=>{const b=batch(await h.owner.state(),id);return {batchId:id,version:b.version,fingerprint:b.fingerprint}}
 // Review is non-destructive even when every source is classified out of scope.
 const before=native(await h.owner.state()),skips=structuredClone(records)
 skips[0].status='review';skips[1].source={type:'clickwrap',clickwrapId:'historic-acceptance'}
 const skipped=await preview({...payload(skips,fixture.documents)})
 assert.equal(skipped.counts.skip,2);assert.equal(skipped.counts.import,0)
 assert.deepEqual(native(await h.owner.state()),before)
 const skipReport=JSON.parse(batch(await h.owner.state(),skipped.batchId).preview)
 assert.match(skipReport.rows[0].notes.join(' '),/MOVE-006/);assert.match(skipReport.rows[1].notes.join(' '),/MOVE-007/)
 // Shared filenames must never assign the same original to two records.
 const ambiguous=structuredClone(records);for(const r of ambiguous){delete r.parentId;r.childIds=[];r.attachments={signedCopy:{filename:'shared.pdf'}}}
 const held=await preview({...payload(ambiguous,[['shared.pdf',pdf('Shared ambiguous original')]])})
 assert.equal(held.counts.missing,2);assert.equal(held.counts.import,0)
 const cross=structuredClone(records);cross[1].attachments.signedCopy.filename=records[0].attachments.signedCopy.filename
 const crossReview=await preview({...payload(cross,fixture.documents)})
 assert.equal(crossReview.counts.missing,1)
 const reviewed=JSON.parse(batch(await h.owner.state(),crossReview.batchId).preview)
 assert.ok(reviewed.rows[0].schedules.some(f=>f.path.endsWith('/schedule.pdf')))
 assert.equal(reviewed.rows[1].document.path.split('/')[0],records[1].id)
 // Stale entity, current roles and revoked sessions are exercised at HTTP doors.
 const entityReview=await preview(),es=(await h.owner.state()).entities.find(e=>e.id===entityId)
 await h.owner.command('entity.save',{...entity,id:entityId,version:es.version,noticeAddress:'2 Updated Example Street, Wilmington, DE'})
 await h.owner.command('import.apply',await applyArgs(entityReview.batchId),{error:'STALE'})
 assert.deepEqual(native(await h.owner.state()),before)
 const delegate=await h.invite('move-controls-owner@example.test','owner')
 const roleReview=await delegate.command('import.preview',{...input,entityId,mapping})
 await h.owner.command('role.set',{operatorId:delegate.id,role:'viewer'})
 await delegate.command('import.apply',await applyArgs(roleReview.batchId),{error:'FORBIDDEN'})
 for(const type of ['import.inspect','import.preview','import.apply','import.undo','import.ironclad.start','import.ironclad.poll']){
  assert.equal((await h.request('/api/locket/commands',{method:'POST',body:{commandId:randomUUID(),type,payload:input}})).status,401)
 }
 await h.owner.command('role.set',{operatorId:delegate.id,role:'owner'})
 await delegate.request('/auth/signout',{method:'POST',body:{}})
 assert.equal((await delegate.request('/api/locket/commands',{method:'POST',body:{commandId:randomUUID(),type:'import.apply',payload:await applyArgs(roleReview.batchId)}})).status,401)
 assert.equal((await delegate.request('/api/locket/export')).status,401)
 // Typed native/custom values use the same parser; dates and USD remain proposals.
 const typed=structuredClone(records.slice(0,1));typed[0].childIds=[]
 typed[0].properties['Auto-Renewal Type']={type:'string',value:'Optional Extension'}
 typed[0].properties['Renewal Term Length']={type:'duration',value:'P1Y6M'}
 typed[0].properties['Number of Renewals']={type:'number',value:2}
 const actor=(await h.owner.state()).actor
 const party=(await h.owner.command('party.save',{name:'Typed lookup counterparty',kind:'other'})).id
 const specs=[['Seats','number',{type:'number',value:42},42],['Approved source','yes_no',{type:'boolean',value:false},false],['Category','pick_list',{type:'string',value:'Operations'},'Operations'],['Review date','date',{type:'date',value:'2027-01-31T00:00:00Z'},'2027-01-31'],['Budget','money',{type:'monetary_amount',value:{amount:25.15,currency:'USD'}},2515],['Steward','person',{type:'string',value:actor.id},actor.id],['Supplier lookup','counterparty',{type:'string',value:party},party]]
 const typedMap=structuredClone(mapping),fields=[]
 for(const [name,kind,value,expected] of specs){
  const spec={name,kind,agreementTypes:['supplier'],requiredStages:[],editRoles:['owner'],options:kind==='pick_list'?['Operations','Legal']:[]}
  const f=await h.owner.command('field.save',spec);fields.push({...f,...spec,expected});typed[0].properties[name]=value;typedMap.properties[name]='custom:'+f.id
 }
 const typedInput=payload(typed,fixture.documents),tp=await h.owner.command('import.preview',{...typedInput,entityId,mapping:typedMap})
 await apply(h.owner,tp.batchId)
 let state=await h.owner.state(),agreement=state.agreements.find(a=>a.title===typed[0].name)
 assert.ok(agreement)
 assert.ok(state.terms.some(t=>t.agreement_id===agreement.id&&t.key==='renewal_type'&&t.value==='optional'&&t.status==='proposed'))
 assert.ok(state.terms.some(t=>t.agreement_id===agreement.id&&t.key==='renewal_term_months'&&t.value==='18'))
 for(const f of fields){
  if(['date','money'].includes(f.kind))assert.equal(JSON.parse(state.terms.find(t=>t.agreement_id===agreement.id&&t.key==='custom:'+f.id).value),f.expected)
  else assert.equal(JSON.parse(state.customValues.find(v=>v.agreement_id===agreement.id&&v.field_id===f.id).value),f.expected)
 }
 assert.ok(!state.renewals.some(r=>r.agreement_id===agreement.id));assert.equal(agreement.value_cents,null)
 await undo(h.owner,tp.batchId)
 assert.ok(!(await h.owner.state()).customValues.some(v=>v.agreement_id===agreement.id))
 const restricted=await h.owner.command('field.save',{name:'Counsel-only source',kind:'text',agreementTypes:['supplier'],requiredStages:[],editRoles:['counsel'],options:[]})
 const denied=structuredClone(typed);denied[0].properties['Counsel only']={type:'string',value:'Secret'}
 await h.owner.command('import.preview',{...payload(denied,fixture.documents),entityId,mapping:{...typedMap,properties:{...typedMap.properties,'Counsel only':'custom:'+restricted.id}}},{error:'IRONCLAD_MAPPING'})
 const invalid=structuredClone(typed);invalid[0].properties.Budget.value.currency='EUR'
 await h.owner.command('import.preview',{...payload(invalid,fixture.documents),entityId,mapping:typedMap},{error:'IRONCLAD_VALUE'})
 invalid[0].properties.Budget.value.currency='USD';invalid[0].properties['Renewal Term Length'].value='P1M2D'
 await h.owner.command('import.preview',{...payload(invalid,fixture.documents),entityId,mapping:typedMap},{error:'IRONCLAD_VALUE'})
 // A digest-only duplicate, or a changed prior parent, cannot enter a frozen plan.
 const clean=await preview();await apply(h.owner,clean.batchId)
 state=await h.owner.state();const preserved=native(state)
 const copies=structuredClone(records);copies.forEach((r,i)=>{r.id='new-identity-'+i;delete r.parentId;r.childIds=[];r.attachments={signedCopy:{filename:'copy-'+i+'.pdf'}}})
 const duplicateInput=payload(copies,copies.map((r,i)=>[r.id+'/copy-'+i+'.pdf',fixture.documents[i][1]]))
 const dup=await h.owner.command('import.preview',{...duplicateInput,entityId,mapping})
 assert.equal(dup.counts.duplicate,2);assert.equal(dup.counts.import,0);assert.deepEqual(native(await h.owner.state()),preserved)
 await undo(h.owner,clean.batchId)
 const race=await preview(),other=await preview()
 await apply(h.owner,other.batchId)
 await h.owner.command('import.apply',await applyArgs(race.batchId),{error:'STALE'})
 await undo(h.owner,other.batchId)
 const parentInput=payload([records[0]],fixture.documents),parentPreview=await h.owner.command('import.preview',{...parentInput,entityId,mapping})
 await apply(h.owner,parentPreview.batchId)
 const childInput=payload([records[1]],fixture.documents),childPreview=await h.owner.command('import.preview',{...childInput,entityId,mapping})
 state=await h.owner.state();const parent=state.agreements.find(r=>r.title===records[0].name)
 const correction=await prepareBulk(h.owner,[parent.id],{changes:{title:parent.title+' corrected'}});await applyBulk(h.owner,correction.operationId)
 await h.owner.command('import.apply',await applyArgs(childPreview.batchId),{error:'STALE'})
 assert.equal((await h.owner.state()).agreements.length,1)
 // Re-import a separate typed record and confirm the date/money against its original.
 const confirmed=structuredClone(typed);confirmed[0].id='confirmed-typed-record';confirmed[0].parentId=undefined;confirmed[0].attachments={signedCopy:{filename:'typed.pdf'}}
 const confirmedInput=payload(confirmed,[['confirmed-typed-record/typed.pdf',pdf('Typed source. '+passage)]])
 const cp=await h.owner.command('import.preview',{...confirmedInput,entityId,mapping:typedMap});await apply(h.owner,cp.batchId)
 state=await h.owner.state();const ca=state.agreements.find(a=>state.artifacts.some(f=>f.agreement_id===a.id&&f.source_id==='confirmed-typed-record'))
 for(const f of fields.filter(f=>['date','money'].includes(f.kind))){const term=state.terms.find(t=>t.agreement_id===ca.id&&t.key==='custom:'+f.id);await h.owner.command('term.decide',{agreementId:ca.id,termId:term.id,decision:'confirm',citation:{quote:passage,page:1}})}
 state=await h.owner.state()
 for(const f of fields.filter(f=>['date','money'].includes(f.kind)))assert.equal(JSON.parse(state.customValues.find(v=>v.agreement_id===ca.id&&v.field_id===f.id).value),f.expected)
 await undo(h.owner,cp.batchId,{error:'IMPORT_DEPENDENCY'})
}

