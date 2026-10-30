import {prepareBulk,applyBulk} from './repository-bulk-fixture.mjs'
import assert from 'node:assert/strict'
import {file,pdf} from './files.mjs'
import {passage} from '../fixtures/ironclad/archive.mjs'
export async function importedInheritance(h,{roots,viewer,clock,calendarEvents}) {
 let s=await h.owner.state(),root=roots[0],other=roots[1]
 const current=()=>h.owner.state().then(s=>s.agreements.find(a=>a.id===root.id))
 const definition={query:'Ironclad',filters:[{field:'type',operator:'eq',value:'supplier'},{field:'current_term_end',operator:'eq',value:'2027-02-28'}],sort:{field:'title',direction:'asc'},columns:['title','current_term','current_term_end','end_date','notice_deadline','lifecycle','entity']}
 const view=await h.owner.command('view.save',{name:'Imported current terms',definition,sharedRoles:[]})
 const repository=await(await h.owner.request('/api/locket/repository?viewId='+view.id)).json()
 assert.deepEqual(repository.rows.map(r=>r.id).sort(),roots.map(r=>r.id).sort())
 for(const r of repository.rows){assert.equal(r.values.current_term,5);assert.equal(r.values.current_term_end,'2027-02-28');assert.equal(r.values.end_date,'2023-02-28');assert.equal(r.values.notice_deadline,'2026-12-30');assert.equal(r.values.lifecycle,'auto_renewing')}
 const selected=await h.owner.command('renewal.bulk.preview',{agreementIds:repository.rows.map(r=>r.id),ownerId:s.actor.id,offsets:[90,30,7]})
 assert.equal(selected.tracked.length,2)
 const report=await h.owner.command('report.create',{name:'Imported renewal months',viewId:view.id,groupField:'notice_deadline',frequency:'weekly',format:'csv',firstAt:'2026-11-01T08:00',recipients:[s.actor.id]})
 const reportResult=await(await h.owner.request('/api/locket/reports/'+report.id)).json()
 assert.deepEqual(reportResult.groups,[{group:'2026-12',count:2,value:2000000,missing:0}])
 const portfolio=await(await h.owner.request('/api/locket/portfolio?entityId='+root.entity_id)).json()
 for(const a of roots){assert.equal(portfolio.lifecycle[a.id].term,5);assert.equal(portfolio.lifecycle[a.id].end,'2027-02-28');assert.ok(portfolio.tiles.find(t=>t.id==='notice-90').agreementIds.includes(a.id))}
 await h.owner.command('renewal.brief.configure',{agreementId:root.id,version:(await current()).version,leadDays:90,decisionMakerId:s.actor.id})
 const brief=await h.owner.command('renewal.brief.prepare',{agreementId:root.id})
 s=await h.owner.state();const retained=s.renewalBriefs.find(b=>b.id===brief.id),content=JSON.parse(retained.content)
 assert.equal(content.current.term,5);assert.equal(content.current.end,'2027-02-28');assert.equal(content.deadline,Date.parse('2026-12-31T04:59:59Z'))
 await h.owner.command('calendar.connect',{provider:'google',calendarId:'synthetic-import-calendar',accessToken:'synthetic-import-token',scope:'all_accessible',consent:true})
 await h.scheduled(clock)
 assert.equal(calendarEvents.length,4)
 assert.equal(calendarEvents.filter(e=>e.summary==='Notice deadline'&&e.start.dateTime==='2026-12-31T04:59:59.000Z').length,2)
 // Imported sources retain cited human choices, current-version guards and visibility.
 const child=s.agreements.find(a=>a.parent_id===root.id&&a.relation==='amends')
 let term=s.terms.find(t=>t.agreement_id===child.id&&t.key==='end_date')
 await h.owner.command('term.decide',{agreementId:child.id,termId:term.id,decision:'confirm',citation:{quote:passage,page:1}})
 s=await h.owner.state();term=s.terms.find(t=>t.id===term.id)
 const deadlines=s.renewals.filter(r=>roots.some(a=>a.id===r.agreement_id)).map(r=>[r.agreement_id,r.deadline_at]).sort()
 const rootRevision=(await current()).version
 await h.owner.command('family.term',{agreementId:other.id,termId:term.id},{error:'FAMILY'})
 await h.owner.command('family.term',{agreementId:root.id,version:rootRevision-1,termId:term.id},{error:'STALE'})
 await viewer.command('family.term',{agreementId:root.id,termId:term.id},{error:'FORBIDDEN'})
 await h.owner.command('family.term',{agreementId:root.id,version:rootRevision,termId:term.id})
 const get=async person=>(await(await person.request('/api/locket/families/'+root.id)).json())
 let family=await get(h.owner),choice=family.governing.find(g=>g.term_id===term.id)
 assert.equal(choice.selected_by,s.actor.id);assert.equal(choice.selected_at,clock);assert.equal(choice.term.id,term.id);assert.equal(choice.source.id,child.id)
 const cite=JSON.parse(choice.term.citation);assert.equal(cite.quote,passage);assert.equal(cite.page,1);assert.equal(cite.versionId,child.current_version_id)
 // Distinct recorded start dates establish order independently of creation order.
 const memberDates=family.members.map((a,i)=>[a.id,`2026-0${5-i}-01`])
 for(const [id,startDate]of memberDates){const op=await prepareBulk(h.owner,[id],{changes:{start_date:startDate}});await applyBulk(h.owner,op.operationId)}
 family=await get(h.owner);assert.deepEqual(family.members.map(a=>a.id),memberDates.slice().reverse().map(([id])=>id))
 let a=(await h.owner.state()).agreements.find(a=>a.id===child.id)
 const privateEdit=await prepareBulk(h.owner,[child.id],{changes:{restricted:true}});await applyBulk(h.owner,privateEdit.operationId)
 const hidden=await get(viewer);assert.equal(hidden.members.length,4);assert.ok(!JSON.stringify(hidden).includes(child.id));assert.ok(!hidden.governing.some(g=>g.term_id===term.id))
 assert.equal((await viewer.request('/api/locket/files/'+s.artifacts.find(f=>f.agreement_id===child.id).id)).status,404)
 await h.owner.command('access.set',{agreementId:child.id,operatorId:viewer.id,grant:'grant'})
 assert.equal((await get(viewer)).members.length,5)
 assert.equal((await viewer.request('/api/locket/files/'+s.artifacts.find(f=>f.agreement_id===child.id).id)).status,200)
 await h.owner.command('access.set',{agreementId:child.id,operatorId:viewer.id,grant:'revoke'})
 assert.equal((await get(viewer)).members.length,4)
 const audit=(await(await h.owner.request('/api/locket/audit?agreement='+child.id+'&action=agreement.view')).json()).rows
 assert.ok(audit.some(e=>e.actor_id===viewer.id&&e.actor_role==='viewer'&&e.at&&e.agreement_id===child.id))
 // A changed source relation becomes review-required without changing deadlines.
 a=(await h.owner.state()).agreements.find(a=>a.id===child.id)
 await h.owner.command('family.link',{agreementId:child.id,version:a.version,parentId:root.id,parentVersion:(await current()).version,relation:'schedule_to'})
 assert.equal((await get(h.owner)).governing.find(g=>g.term_id===term.id).stale,true)
 a=(await h.owner.state()).agreements.find(a=>a.id===child.id)
 await h.owner.command('family.link',{agreementId:child.id,version:a.version,parentId:root.id,parentVersion:(await current()).version,relation:'amends'})
 assert.equal((await get(h.owner)).governing.find(g=>g.term_id===term.id).stale,false)
 a=(await h.owner.state()).agreements.find(a=>a.id===child.id)
 await h.owner.command('version.upload',{agreementId:child.id,version:a.version,kind:'upload',file:file('changed-source.pdf',pdf('Changed current source.'))})
 assert.equal((await get(h.owner)).governing.find(g=>g.term_id===term.id).stale,true)
 await h.owner.command('family.term',{agreementId:root.id,version:(await current()).version,termId:term.id},{error:'SOURCE'})
 assert.deepEqual((await h.owner.state()).renewals.filter(r=>roots.some(a=>a.id===r.agreement_id)).map(r=>[r.agreement_id,r.deadline_at]).sort(),deadlines)
 // Both limit-expiry and human termination produce reasoned imported selection skips.
 const proposal=await h.owner.command('term.propose',{agreementId:other.id,key:'renewals_allowed',value:'1',citation:{quote:passage,page:1}})
 await h.owner.command('term.decide',{agreementId:other.id,termId:proposal.id,decision:'confirm'})
 await h.owner.command('renewal.terminate',{agreementId:root.id,version:(await current()).version,effectiveDate:'2026-10-01',citation:{quote:passage,page:1},reason:'Human confirmed imported termination evidence.'})
 const skipped=await h.owner.command('renewal.bulk.preview',{agreementIds:roots.map(a=>a.id),ownerId:s.actor.id,offsets:[30]})
 assert.equal(skipped.tracked.length,0);assert.deepEqual(skipped.skipped.map(r=>r.reason).sort(),['Expired','Terminated'])
}
