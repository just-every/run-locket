import test from 'node:test'
import assert from 'node:assert/strict'
import { installation } from './harness.mjs'
import { searchFixture, searchDefinition, searchText } from './search-fixture.mjs'
import { file, docx } from './files.mjs'

test('REPO-006 current-term structured search, all version passages, scoped filters, literal offsets and authenticated navigation data', async t => {
  const h = await installation({ bindings: { TEST_NOW: String(Date.parse('2026-10-17T12:00:00Z')) } }); t.after(() => h.close())
  const ids = await searchFixture(h.owner)
  const viewer = await h.invite('search-viewer@example.test', 'viewer')
  const search = async (client, definition) => {
    const res = await client.request('/api/locket/search?definition=' + encodeURIComponent(JSON.stringify(definition)))
    assert.equal(res.status, 200); return (await res.json()).results
  }
  let results = await search(viewer, searchDefinition)
  assert.deepEqual(results.map(r => r.id), [ids.current])
  assert.equal(results[0].matches.length, 2)
  for (const hit of results[0].matches) {
    assert.equal(searchText.slice(hit.start, hit.end), hit.quote)
    assert.equal(hit.quote.toLowerCase(), searchDefinition.query)
    assert.equal(hit.version, 1)
    assert.ok(hit.versionId)
  }
  results = await search(viewer, { ...searchDefinition, filters: [{ field: 'lifecycle', operator: 'eq', value: 'expired' }] })
  assert.deepEqual(results.map(r => r.id), [ids.expired])
  const s = await h.owner.state(), a = s.agreements.find(a => a.id === ids.current), person = s.actor.name
  for (const filter of [
    ['status', 'eq', 'imported'], ['counterparty', 'contains', 'Northwind current'], ['owner', 'eq', person],
    ['effective_date', 'eq', '2022-03-01'], ['end_date', 'eq', '2023-02-28'], ['notice_deadline', 'eq', '2026-12-30'],
    ['auto_renew', 'eq', 'yes'], ['governing_law', 'eq', 'New York'], ['payment_terms', 'eq', 'Net 30'],
  ]) {
    const [field, operator, value] = filter
    const rows = await search(viewer, { ...searchDefinition, filters: [...searchDefinition.filters, { field, operator, value }] })
    assert.deepEqual(rows.map(r => r.id), [ids.current], field)
  }
  assert.deepEqual(await search(viewer, { ...searchDefinition, filters: [...searchDefinition.filters, {field:'value',operator:'lte',value:'249999.99'}] }), [])
  assert.deepEqual(await search(viewer, { ...searchDefinition, query: 'definitely absent' }), [])
  const byMetadata = await search(viewer, { ...searchDefinition, query: a.reference, filters: [] })
  assert.deepEqual(byMetadata.map(r => r.id), [ids.current]); assert.deepEqual(byMetadata[0].matches, [])
  const raw = await (await viewer.request('/api/locket/search?q=LIMITATION%20OF%20LIABILITY')).json()
  assert.equal(raw.results.length, 4); assert.ok(!JSON.stringify(raw).includes(ids.hidden))
  const draft = await h.owner.command('request.create', { title: 'Revised supplier paper', type:'other', party:{name:'Revised supplier',kind:'supplier'}, file:file('first.docx',docx(['An ordinary first version.'])) })
  let d = (await h.owner.state()).agreements.find(a => a.id === draft.id)
  await h.owner.command('version.upload',{agreementId:d.id,version:d.version,kind:'counterparty',file:file('second.docx',docx(['A literal (liability)+ term.','İ Unicode limitation of liability.']))})
  d = (await h.owner.state()).agreements.find(a => a.id === draft.id)
  await h.owner.command('version.upload',{agreementId:d.id,version:d.version,kind:'counterparty',file:file('third.docx',docx(['The replacement no longer contains the clause.']))})
  const literal = await search(viewer,{...searchDefinition,query:'(liability)+',filters:[]})
  assert.equal(literal[0].matches[0].quote,'(liability)+'); assert.equal(literal[0].matches[0].version,2)
  const unicode = await search(viewer,{...searchDefinition,filters:[]})
  const u = unicode.find(r=>r.id===draft.id).matches[0]
  assert.equal('A literal (liability)+ term.\nİ Unicode limitation of liability.'.slice(u.start,u.end),u.quote)
  const playbook = await h.owner.command('playbook.draft',{rules:[{key:'liability',title:'Liability',preferred:'Cap',alternatives:[],authority:'counsel'}]})
  await h.owner.command('playbook.activate',{id:playbook.id})
  d = (await h.owner.state()).agreements.find(a => a.id === draft.id)
  const v = (await h.owner.state()).versions.find(v=>v.id===d.current_version_id)
  await h.owner.command('deviation.add',{agreementId:d.id,versionId:v.id,clauseKey:'liability',result:'breached',start:0,end:v.text.length,quote:v.text,explanation:'Cap is absent.',questions:[]})
  assert.deepEqual((await search(viewer,{...searchDefinition,query:'',filters:[{field:'deviations',operator:'contains',value:'liability'},{field:'has_deviations',operator:'eq',value:'yes'}]})).map(r=>r.id),[draft.id])
  await h.owner.command('access.set',{agreementId:ids.hidden,operatorId:viewer.id,grant:'grant'})
  assert.equal((await search(viewer,searchDefinition)).length,2)
  await h.owner.command('access.set',{agreementId:ids.hidden,operatorId:viewer.id,grant:'revoke'})
  assert.equal((await search(viewer,searchDefinition)).length,1)
  assert.ok((await h.owner.state()).audit.some(a=>a.action==='agreement.view'&&a.actor_id===viewer.id&&a.agreement_id===ids.hidden))
  assert.equal((await h.request('/api/locket/search?q=liability')).status,401)
  const ownerId=(await h.owner.state()).actor.id
  const department=await h.owner.command('audience.save',{name:'Legal department',kind:'department',memberIds:[ownerId]})
  const form=await h.owner.command('form.save',{definition:{name:'Department intake',type:'nda',fields:[],requirements:[],launch:{roles:['owner'],audienceIds:[]},defaultRoute:{ownerId,reviewerId:ownerId,approvalRole:'approver'},rules:[]}})
  const published=await h.owner.command('form.publish',form)
  const fromForm=await h.owner.command('request.create',{title:'synthetic-locket-department',type:'nda',party:{name:'synthetic-locket-department',kind:'customer'},formVersionId:published.versionId,formAnswers:{department:department.id}})
  const departmentSearch={...searchDefinition,query:'',filters:[{field:'department',operator:'eq',value:'Legal department'}],columns:['title','department']}
  assert.deepEqual((await search(viewer,departmentSearch)).map(r=>r.id),[fromForm.id])
  assert.equal((await viewer.state()).agreements.find(a=>a.id===fromForm.id).department,'Legal department')
  const other=await h.owner.command('audience.save',{name:'Finance department',kind:'department',memberIds:[]})
  const formed=(await h.owner.state()).agreements.find(a=>a.id===fromForm.id)
  await h.owner.command('agreement.department',{agreementId:fromForm.id,version:formed.version,departmentId:other.id})
  assert.deepEqual(await search(viewer,departmentSearch),[])
  assert.deepEqual((await search(viewer,{...departmentSearch,filters:[{field:'department',operator:'eq',value:'Finance department'}]})).map(r=>r.id),[fromForm.id])
  await h.owner.command('audience.save',{id:other.id,version:other.version,name:'Renamed finance',kind:'department',memberIds:[]})
  assert.deepEqual((await search(viewer,{...departmentSearch,query:'Renamed finance',filters:[]})).map(r=>r.id),[fromForm.id])
  assert.equal((await viewer.request('/api/locket/search?definition='+encodeURIComponent(JSON.stringify({...searchDefinition,filters:[{field:'unknown_department',operator:'eq',value:'Legal'}]})))).status,400)
})

test('REPO-002 embedded PDF passages navigate actual pages and exclude stale or revoked sources', async t => {
 const {embeddedPdf,pdfClause,nativePdfImport}=await import('./pdf-rendition-fixture.mjs')
 const h=await installation();t.after(()=>h.close())
 const imported=await h.owner.command('legacy.import',{...nativePdfImport(await embeddedPdf('synthetic-locket-search')) ,restricted:true})
 const created=await h.owner.command('request.create',{title:'synthetic-locket-draft',type:'other',party:{name:'synthetic-locket-draft',kind:'supplier'},file:file('draft.pdf',await embeddedPdf('synthetic-locket-draft'))})
 let s=await h.owner.state(),a=s.agreements.find(a=>a.id===created.id)
 const v1=s.versions.find(v=>v.id===created.versionId),v1digest=v1.digest
 const uploaded=await h.owner.command('version.upload',{agreementId:a.id,version:a.version,kind:'counterparty',file:file('revised.pdf',await embeddedPdf('synthetic-locket-revised',{blankPage:true}))})
 const search=async(client)=>{const response=await client.request('/api/locket/search?q='+encodeURIComponent('Aurora escrow'));assert.equal(response.status,200);return (await response.json()).results}
 assert.deepEqual(await search(h.owner),[])
 await h.scheduled(Date.now())
 const {erasureSubject,erasureRequest,erasureConfirmation}=await import('./erasure-fixture.mjs')
 const viewer=await h.invite(erasureSubject.email,'viewer')
 let results=await search(viewer)
 assert.deepEqual(results.map(r=>r.id),[created.id])
 assert.deepEqual(results[0].matches.map(m=>m.version),[1,2])
 for(const hit of results[0].matches){
  assert.equal(hit.page,14);assert.equal(hit.quote,'Aurora escrow');assert.ok(hit.renditionId);assert.ok(hit.artifactId)
  assert.equal(hit.position.x,50);assert.equal(hit.position.y,80)
  const r=(await viewer.state()).pdfRenditions.find(r=>r.id===hit.renditionId)
  assert.equal(r.text.slice(hit.start,hit.end),'Aurora escrow');assert.equal(r.text.slice(hit.position.start,hit.position.end),pdfClause)
 }
 s=await h.owner.state()
 assert.equal(s.versions.find(v=>v.id===created.versionId).digest,v1digest)
 const mixed=s.pdfRenditions.find(r=>r.version_id===uploaded.versionId)
 assert.equal(mixed.status,'partial');assert.equal(mixed.pages[19].status,'unavailable');assert.equal(mixed.pages[19].text,'');assert.deepEqual(mixed.pages[19].anchors,[])
 await h.owner.command('access.set',{agreementId:imported.id,operatorId:viewer.id,grant:'grant'})
 assert.equal((await search(viewer)).length,2)
 await h.owner.command('access.set',{agreementId:imported.id,operatorId:viewer.id,grant:'revoke'})
 assert.deepEqual((await search(viewer)).map(r=>r.id),[created.id])
 assert.ok(!(await viewer.state()).pdfRenditions.some(r=>r.agreement_id===imported.id))
 const hidden=(await h.owner.state()).pdfRenditions.find(r=>r.agreement_id===imported.id)
 assert.equal((await viewer.request('/api/locket/files/'+hidden.artifact_id)).status,404)
 // A public signing-rendition update changes this version's identity. Its old
 // derived text must be withheld rather than rebound to the new approved source.
 a=(await h.owner.state()).agreements.find(a=>a.id===created.id)
 await h.owner.command('version.rendition',{agreementId:a.id,version:a.version,versionId:uploaded.versionId,file:file('signing.pdf',await embeddedPdf('synthetic-locket-signing'))})
 results=await search(h.owner)
 assert.deepEqual(results.find(r=>r.id===created.id).matches.map(m=>m.version),[1])
 s=await h.owner.state();const stale=s.pdfRenditions.find(r=>r.id===mixed.id)
 assert.equal(stale.status,'stale');assert.equal(stale.text,'');assert.deepEqual(stale.pages,[])
 assert.equal((await h.request('/api/locket/search?q=Aurora')).status,401)
 await h.owner.command('repository.access',{version:0,enabled:false,grants:[],hiddenFields:[{role:'viewer',fields:['value']}]})
 assert.deepEqual((await search(viewer)),[]);assert.deepEqual((await viewer.state()).pdfRenditions,[])
 const party=await h.owner.command('party.save',{name:'synthetic-locket-erasure',kind:'supplier',email:erasureSubject.email,contacts:[erasureSubject]})
 const privateBytes=await embeddedPdf(erasureSubject.name)
 const privateImport=await h.owner.command('legacy.import',{...nativePdfImport(privateBytes,'synthetic-locket-erasure'),party:undefined,partyId:party.id})
 await h.scheduled(Date.now())
 const queuedImport=await h.owner.command('legacy.import',{...nativePdfImport(await embeddedPdf(erasureSubject.name+' pending'),'synthetic-locket-erasure-queued'),party:undefined,partyId:party.id})
 assert.ok((await h.owner.state()).pdfRenditions.find(r=>r.agreement_id===privateImport.id).text.includes(erasureSubject.name))
 const preview=await h.owner.command('person.erase.preview',erasureRequest())
 await h.owner.command('person.erase',erasureConfirmation(preview,erasureSubject.email,[]))
 await h.scheduled(Date.now()+60000)
 s=await h.owner.state()
 for(const id of [privateImport.id,queuedImport.id]){
  const erased=s.pdfRenditions.find(r=>r.agreement_id===id)
  assert.equal(erased.status,'erased');assert.equal(erased.text,'');assert.deepEqual(erased.pages,[])
 }
 const erasedSearch=await (await h.owner.request('/api/locket/search?q='+encodeURIComponent(erasureSubject.name))).json()
 assert.ok(!erasedSearch.results.some(r=>[privateImport.id,queuedImport.id].includes(r.id)))
 const retained=s.artifacts.find(f=>f.agreement_id===privateImport.id&&f.role==='original')
 assert.deepEqual(Buffer.from(await (await h.owner.request('/api/locket/files/'+retained.id)).arrayBuffer()),privateBytes,'erasure cancels derived work while retaining contracted originals')
})
