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
