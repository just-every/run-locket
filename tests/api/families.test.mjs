import test from 'node:test'
import assert from 'node:assert/strict'
import { installation } from './harness.mjs'
import { familyFixture } from './family-fixture.mjs'
import { find } from './setup.mjs'
import { familyConflictFixture } from './family-conflict-fixture.mjs'

test('REPO-008 six guarded family relations, date order, human-selected cited governing terms and agent proposals', async t => {
  const h = await installation(); t.after(() => h.close())
  const ids = await familyFixture(h.owner)
  const link = async (id, relation, parentId = ids.master, extra = {}) => h.owner.command('family.link', {agreementId:id,version:(await find(h.owner,id)).version,parentId,relation,...extra})
  await link(ids.first,'order_under'); await link(ids.second,'order_under'); await link(ids.amendment,'amends')
  const get = async client => {const r=await client.request(`/api/locket/families/${ids.master}`);assert.equal(r.status,200);return r.json()}
  assert.deepEqual((await get(h.owner)).members.map(a=>a.id),[ids.master,ids.first,ids.second,ids.amendment])
  const root = await find(h.owner,ids.master)
  await h.owner.command('family.term',{agreementId:ids.master,version:root.version,termId:ids.termId})
  let f=await get(h.owner)
  assert.equal(f.governing[0].term.value,'2028-12-31'); assert.equal(f.governing[0].source.id,ids.amendment)
  assert.deepEqual(JSON.parse(f.governing[0].term.citation),{source:'signed-pdf-page',versionId:(await find(h.owner,ids.amendment)).current_version_id,quote:'Term ends December 31, 2028.',page:1})
  assert.equal(f.governing[0].stale,false)
  await link(ids.amendment,'schedule_to')
  assert.equal((await get(h.owner)).governing[0].stale,true)
  const unrelated = await h.owner.command('request.create',{title:'Separate framework',type:'other',party:{name:'Separate Inc.',kind:'other'}})
  await link(ids.amendment,'amends',unrelated.id)
  assert.equal((await get(h.owner)).governing[0].stale,true)
  await link(ids.amendment,'amends')
  assert.equal((await get(h.owner)).governing[0].stale,false)
  assert.ok(!(await h.owner.state()).renewals.some(r=>r.agreement_id===ids.master))
  const requester=await h.invite('requester-family@example.test','requester')
  await requester.command('family.link',{agreementId:ids.first,version:(await find(h.owner,ids.first)).version,parentId:ids.master,relation:'amends'},{error:'FORBIDDEN'})
  await requester.command('family.term',{agreementId:ids.master,version:(await find(h.owner,ids.master)).version,termId:ids.termId},{error:'FORBIDDEN'})
  await link(ids.first,'statement_of_work_under');await link(ids.first,'schedule_to');await link(ids.first,'renews');await link(ids.first,'supersedes')
  await h.owner.command('family.link',{agreementId:ids.master,version:(await find(h.owner,ids.master)).version,parentId:ids.first,relation:'amends'},{error:'INVALID'})
  await h.owner.command('family.link',{agreementId:ids.first,version:(await find(h.owner,ids.first)).version,parentId:ids.master,parentVersion:root.version,relation:'order_under'},{error:'STALE'})
  const agent=await h.invite('family-agent@example.test','agent')
  await agent.command('family.link',{agreementId:ids.second,version:(await find(h.owner,ids.second)).version,parentId:ids.master,relation:'amends'},{error:'FORBIDDEN'})
  const proposal=await agent.command('proposal.prepare',{kind:'family',payload:{agreementId:ids.second,parentId:ids.master,relation:'schedule_to'},evidence:['Schedule refers to the MSA.']})
  assert.equal((await find(h.owner,ids.second)).relation,'order_under')
  await h.owner.command('proposal.decide',{proposalId:proposal.id,decision:'approve'})
  assert.equal((await find(h.owner,ids.second)).relation,'schedule_to')
  const replacement=await h.owner.command('term.propose',{agreementId:ids.amendment,key:'end_date',value:'2029-12-31',citation:{quote:'Later agreed date.',page:1}})
  await h.owner.command('term.decide',{agreementId:ids.amendment,termId:replacement.id,decision:'confirm'})
  assert.equal((await get(h.owner)).governing[0].stale,true)
  const hidden=await h.owner.command('request.create',{title:'Confidential acquisition',type:'other',restricted:true,party:{name:'Private Inc.',kind:'other'}})
  await link(hidden.id,'amends')
  const viewer=await h.invite('family-viewer@example.test','viewer')
  f=await get(viewer);assert.ok(!f.members.some(a=>a.id===hidden.id));assert.ok(!JSON.stringify(f).includes('Confidential acquisition'))
  assert.equal((await viewer.request(`/api/locket/families/${hidden.id}`)).status,404)
  const archive=await(await h.owner.request('/api/locket/export')).json()
  assert.equal(archive.records.lk_family_terms.length,1)
  assert.ok((await h.owner.state()).audit.some(a=>a.action==='family.term'&&a.agreement_id===ids.master))
  assert.equal((await h.request(`/api/locket/families/${ids.master}`)).status,401)
})


test('AGENT-005 family differences cite all confirmed notice periods and preview current-term alternatives without choosing precedence', async t => {
  const h = await installation(); t.after(() => h.close())
  await h.setTime(Date.parse('2026-10-17T16:00:00Z'))
  const f = await familyConflictFixture(h.owner)
  const get = async (client = h.owner, id = f.master.id) => {
    const res = await client.request(`/api/locket/families/${id}`)
    assert.equal(res.status, 200)
    return res.json()
  }
  const before = await h.owner.state()
  let result = await get()
  assert.deepEqual(result.conflicts.map(c => c.key), ['notice_days']) // Equal payment terms are not a conflict.
  const candidates = result.conflicts[0].candidates
  assert.deepEqual(candidates.map(c => c.term.value).sort(), ['30', '60', '90'])
  for (const a of [f.master, f.amendment, f.order]) {
    const c = candidates.find(c => c.source.id === a.id)
    assert.equal(JSON.parse(c.term.citation).quote, a.quote)
    assert.equal(JSON.parse(c.term.citation).page, 1)
    assert.equal(c.noticeDeadline.endDate, '2027-02-28') // Current term 5, never the imported 2023 end date.
    assert.equal(c.noticeDeadline.timezone, 'America/New_York')
  }
  assert.equal(candidates.find(c => c.term.value === '90').noticeDeadline.date, '2026-11-30')
  assert.equal(candidates.find(c => c.term.value === '60').noticeDeadline.at, Date.parse('2026-12-31T04:59:59Z'))
  assert.equal(candidates.find(c => c.term.value === '30').noticeDeadline.date, '2027-01-29')
  assert.deepEqual((await get(h.owner, f.order.id)).conflicts, result.conflicts)
  assert.deepEqual((await h.owner.state()).renewals, before.renewals)
  assert.deepEqual((await h.owner.state()).obligations, before.obligations)
  assert.deepEqual((await h.owner.state()).familyTerms, [])

  // Proposals cannot influence differences; correcting a confirmed term drops
  // the superseded candidate immediately, while the original record survives.
  await h.owner.command('term.propose', { agreementId: f.order.id, key: 'notice_days', value: '120', citation: { quote: f.order.quote, page: 1 } })
  assert.deepEqual((await get()).conflicts[0].candidates.map(c => c.term.value).sort(), ['30', '60', '90'])
  await f.confirm(f.order, 'notice_days', '60')
  result = await get()
  assert.deepEqual(result.conflicts[0].candidates.map(c => c.term.value).sort(), ['60', '60', '90'])
  const archive = await (await h.owner.request('/api/locket/export')).json()
  assert.equal(archive.records.lk_terms.find(t => t.id === f.order.noticeTermId).status, 'superseded')
  await f.confirm(f.amendment, 'notice_days', '60')
  assert.deepEqual((await get()).conflicts, [])

  const hidden = await f.create('Confidential notice exception', 180, { restricted: true })
  await f.confirm(hidden, 'notice_days', '180')
  await h.owner.command('family.link', { agreementId: hidden.id, version: (await find(h.owner, hidden.id)).version, parentId: f.master.id, relation: 'amends' })
  const viewer = await h.invite('conflict-viewer@example.test', 'viewer')
  assert.equal((await get()).conflicts[0].candidates.length, 4)
  const visible = await get(viewer)
  assert.deepEqual(visible.conflicts, [])
  assert.ok(!JSON.stringify(visible).includes('Confidential notice exception'))
  assert.equal((await viewer.request(`/api/locket/families/${hidden.id}`)).status, 404)
  assert.equal((await h.request(`/api/locket/families/${f.master.id}`)).status, 401)
})
