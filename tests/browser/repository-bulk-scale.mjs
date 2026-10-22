// Explicit scale acceptance, outside the push Verify suite.
// node tests/browser/repository-bulk-scale.mjs
import assert from 'node:assert/strict'
import {installation} from '../api/harness.mjs'
import {repositoryBulkFixture,prepareBulk,applyBulk,reviewBulk,unzipStored,csvRecords,writeCsv,digest} from '../api/repository-bulk-fixture.mjs'
const h=await installation()
try{
 const {ids,originals}=await repositoryBulkFixture(h.owner,300)
 const colleague=await h.invite('synthetic-locket-9001@example.test','approver'),viewer=await h.invite('synthetic-locket-9002@example.test','viewer'),own=(await h.owner.state()).actor.id
 const obligations=[]
 for(const id of ids.slice(0,40)){
  const o=await h.owner.command('obligation.add',{agreementId:id,description:'Supply synthetic evidence',ownerId:own,dueDate:'2027-06-01',recurrence:'none',citation:{quote:'Agreed terms.'}})
  await h.owner.command('obligation.update',{agreementId:id,obligationId:o.id,action:'confirm'});obligations.push(o.id)
 }
 const sales=await h.owner.command('audience.save',{name:'Sales',kind:'department',memberIds:[]}),finance=await h.owner.command('audience.save',{name:'Finance',kind:'group',memberIds:[colleague.id]})
 const definition={query:'synthetic-locket-',filters:[{field:'status',operator:'eq',value:'imported'}],sort:{field:'title',direction:'asc'},columns:['title','owner','type']}
 const d=await prepareBulk(h.owner,{definition},{changes:{department:sales.id}})
 assert.equal(d.total,300);assert.equal(d.changed,300)
 await applyBulk(h.owner,d.operationId)
 assert.equal((await h.owner.state()).agreementDepartments.filter(x=>x.department_id===sales.id).length,300)
 const reassigned=await prepareBulk(h.owner,ids.slice(0,40),{changes:{owner:colleague.id}});await applyBulk(h.owner,reassigned.operationId)
 const group=await prepareBulk(h.owner,ids.slice(0,25),{changes:{groups:[finance.id]}});await applyBulk(h.owner,group.operationId)
 let s=await h.owner.state()
 assert.equal(s.agreements.filter(a=>a.owner_id===colleague.id).length,40)
 assert.equal((await viewer.state()).agreements.length,275,'Finance assignment restricts exactly 25 records through the current group membership')
 assert.ok(obligations.every(id=>s.obligations.find(o=>o.id===id).owner_id===colleague.id))
 const zipped=await h.owner.command('repository.bulk.select',{agreementIds:ids.slice(0,20)})
 const response=await h.owner.request(`/api/locket/repository/bulk?operationId=${zipped.operationId}&format=zip`);assert.equal(response.status,200)
 const entries=unzipStored(await response.arrayBuffer()),manifest=JSON.parse(entries.get('manifest.json').toString())
 assert.equal(manifest.agreements.length,20);assert.equal(manifest.files.length,20)
 for(const file of manifest.files){assert.equal(digest(entries.get(file.path)),file.sha256);assert.deepEqual(entries.get(file.path),originals.get(file.agreement_id))}
 const selection=await h.owner.command('repository.bulk.select',{definition})
 const csv=csvRecords(await(await h.owner.request(`/api/locket/repository/bulk?operationId=${selection.operationId}&format=csv`)).text()),type=csv[0].indexOf('type')
 for(const row of csv.slice(1,16))row[type]='nda'
 await h.owner.command('repository.bulk.preview',{operationId:selection.operationId,csv:writeCsv(csv)})
 const reviewed=await reviewBulk(h.owner,selection.operationId);assert.equal(reviewed.changed,15);assert.equal(reviewed.skipped,0)
 assert.equal((await h.owner.state()).agreements.filter(a=>a.type==='nda').length,0)
 await applyBulk(h.owner,selection.operationId)
 assert.equal((await h.owner.state()).agreements.filter(a=>a.type==='nda').length,15)
 await h.owner.command('repository.bulk.revert',{operationId:d.operationId})
 const reverted=await applyBulk(h.owner,d.operationId);assert.equal(reverted.reverted,300);assert.equal(reverted.skipped,0)
 s=await h.owner.state();assert.equal(s.agreementDepartments.length,0)
 for(const id of ids)for(const action of ['repository.bulk.apply','repository.bulk.revert'])assert.ok(s.audit.some(a=>a.agreement_id===id&&a.action===action&&a.summary.includes(d.operationId)))
 await viewer.command('repository.bulk.select',{agreementIds:ids},{error:'FORBIDDEN'})
 const stale=await prepareBulk(h.owner,[ids[0]],{changes:{title:'Synthetic revised title'}})
 await h.owner.command('term.propose',{agreementId:ids[0],key:'governing_law',value:'New York',citation:{quote:'Agreed terms.'}})
 const skipped=await applyBulk(h.owner,stale.operationId);assert.equal(skipped.skipped,1);assert.equal(skipped.applied,0)
 console.log(JSON.stringify({clause:'REPO-011',imported:300,department:300,reassigned:40,openObligations:40,finance:25,zip:20,csvDifferences:15,reverted:300,viewerDenied:true,staleSkipped:true}))
}finally{await h.close()}
