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

test('AGENT-005 keeps prepared family sources and derived actions blocked until a passing live provider evaluation', async t => {
 const {familyModelBindings,familyModelFake,familyAnalysisFixture}=await import('./family-analysis-fixture.mjs')
 const prohibitedCalls=[]
 const unapproved=await installation({bindings:{...familyModelBindings,AI_TRAINING_PROHIBITED:'false'},outboundResponse:familyModelFake(prohibitedCalls)})
 try {
  const source=await familyAnalysisFixture(unapproved.owner)
  const snapshot=await unapproved.owner.command('family.analysis.prepare',{agreementId:source.master.id})
  assert.equal((await unapproved.owner.state()).familyModel.enabled,false)
  await unapproved.owner.command('family.analysis.run',{analysisId:snapshot.id,sourceDigest:snapshot.sourceDigest,consent:true},{error:'PROVIDER_POLICY'})
  assert.equal(prohibitedCalls.length,0)
 } finally {await unapproved.close()}
 const calls=[];let mode='ok'
 const h=await installation({bindings:{...familyModelBindings,NOTICE_RESEND_WEBHOOK_SECRET:'synthetic-locket-3'},outboundResponse:familyModelFake(calls,()=>mode)});t.after(()=>h.close())
 await h.setTime(Date.parse('2026-10-17T16:00:00Z'))
 const f=await familyAnalysisFixture(h.owner),counsel=await h.invite('synthetic-locket-family-counsel@example.test','counsel'),agent=await h.invite('synthetic-locket-family-agent@example.test','agent')
 await agent.command('family.analysis.prepare',{agreementId:f.master.id},{error:'FORBIDDEN'})
 const initial=await h.owner.state(),root=initial.agreements.find(a=>a.id===f.master.id),renewal=initial.renewals.find(r=>r.agreement_id===f.master.id),party=initial.parties.find(p=>p.id===root.party_id)
 await h.owner.command('party.save',{id:party.id,version:party.version,name:party.name,kind:'supplier',email:'synthetic-locket-notices@example.test',noticeAddress:'Northwind Legal, 10 Main St, Raleigh NC',noticeMethod:'email',contacts:[],signatories:[]})
 await h.owner.command('renewal.decide',{renewalId:renewal.id,decision:'terminate'})
 const source=await h.owner.command('notice.source',{agreementId:f.master.id,quote:f.master.quote})
 const scheduled=await h.owner.command('notice.agent.prepare',{sourceId:source.id})
 const draft=await h.owner.command('notice.prepare',{renewalId:renewal.id,recipient:'synthetic-locket-notices@example.test',body:'Approved manual notice wording for review.'})
 await h.owner.command('notice.approve',{noticeId:draft.id})
 const waiting=await h.owner.command('notice.prepare',{renewalId:renewal.id,recipient:'synthetic-locket-notices@example.test',body:'Awaiting exact sending approval.'})
 const {approveAgent}=await import('./notice-fixture.mjs')
 const sendAt=Date.parse('2026-10-17T20:00:00Z')
 await approveAgent(h.owner,scheduled.id,sendAt)
 const analysis=await h.owner.command('family.analysis.prepare',{agreementId:f.master.id})
 const before=await h.owner.state()
 assert.ok(before.familyBlocks.includes(f.master.id));assert.equal(calls.length,0)
 await counsel.command('family.analysis.run',{analysisId:analysis.id,sourceDigest:analysis.sourceDigest,consent:true},{error:'FORBIDDEN'})
 await h.owner.command('family.analysis.run',{analysisId:analysis.id,sourceDigest:analysis.sourceDigest,consent:false},{error:'CONSENT'})
 assert.equal(calls.length,0)
 await h.owner.command('notice.prepare',{renewalId:renewal.id,recipient:'synthetic-locket-notices@example.test',body:'Blocked draft'},{error:'FAMILY_BLOCKED'})
 await h.owner.command('notice.approve',{noticeId:waiting.id},{error:'FAMILY_BLOCKED'})
 await h.owner.command('notice.email',{noticeId:draft.id},{error:'FAMILY_BLOCKED'})
 await h.owner.command('notice.sent',{noticeId:draft.id,sentAt:'2026-10-17T16:00:00Z',method:'email'},{error:'FAMILY_BLOCKED'})
 await h.owner.command('notice.source',{agreementId:f.master.id,quote:f.master.quote},{error:'FAMILY_BLOCKED'})
 await h.owner.command('notice.agent.prepare',{sourceId:source.id},{error:'FAMILY_BLOCKED'})
 await h.owner.command('proposal.prepare',{kind:'renewal',payload:{renewalId:renewal.id,recipient:'synthetic-locket-notices@example.test',body:'Draft prepared while family pending'},evidence:['Parent passage']} )
 const proposal=(await h.owner.state()).proposals[0]
 await h.owner.command('proposal.decide',{proposalId:proposal.id,decision:'approve'},{error:'FAMILY_BLOCKED'})
 const batch=await h.owner.command('renewal.bulk.preview',{agreementIds:[f.master.id],ownerId:before.actor.id,offsets:[7]})
 assert.equal(batch.tracked.length,0);assert.match(batch.skipped[0].reason,/Family/)
 await h.owner.command('renewal.decide',{renewalId:renewal.id,decision:'terminate'},{error:'FAMILY_BLOCKED'})
 await h.owner.command('obligation.update',{agreementId:f.master.id,obligationId:f.obligation.id,action:'done',note:'Attempt before resolution'},{error:'FAMILY_BLOCKED'})
 await h.owner.command('family.analysis.run',{analysisId:analysis.id,sourceDigest:analysis.sourceDigest,consent:true},{error:'EVALUATION_REQUIRED'})
 assert.equal(calls.length,0)
 await counsel.command('family.analysis.resolve',{analysisId:analysis.id,scopeAgreementId:f.master.id,choices:[],reason:'No evaluated analysis exists.',obligations:[]},{error:'STATUS'})
 await h.scheduled(sendAt)
 assert.equal((await h.owner.state()).noticePlans.find(p=>p.id===scheduled.id).status,'cancelled')
 assert.equal(h.mails.filter(m=>m.subject==='Contract notice').length,0)
 const state=await h.owner.state()
 assert.equal(state.familyModel.enabled,false)
 assert.equal(state.renewals.find(r=>r.id===renewal.id).notice_days,60)
 assert.equal(state.obligations.find(o=>o.id===f.obligation.id).due_date,'2026-12-30')
 const archive=await(await h.owner.request('/api/locket/export')).json()
 assert.equal(JSON.parse(archive.records.lk_family_analyses[0].sources).length,3)
})

test('Model settings retain provider-simulated review and extraction provenance, acceptance and exact monthly USD estimates', async t => {
 const { modelBindings, modelFake, modelFixture, configureModel, modelQuote } = await import('./model-settings-fixture.mjs')
 const { createHash, randomUUID } = await import('node:crypto')
 const calls = [], h = await installation({ bindings: modelBindings, outboundResponse: modelFake(calls) }); t.after(() => h.close())
 await h.setTime(Date.parse('2026-10-17T16:00:00Z'))
 const f = await modelFixture(h), records = []
 const originals = await (await h.owner.request('/api/locket/export')).json()
 const digest = value => createHash('sha256').update(value).digest('hex')
 for (const [provider, ocrProvider] of [['anthropic', 'textract'], ['openai', 'document-ai'], ['workers-ai', 'document-intelligence']]) {
  await configureModel(h, { provider, ocrProvider })
  assert.equal((await h.owner.state()).models.settings.ocrProvider, ocrProvider)
  for (const task of ['review', 'extraction']) {
   const commandId = randomUUID(), payload = { agreementId: f.supplier.id, task, simulated: true, consent: true }
   await h.owner.command('model.run', { ...payload, simulated: false }, { error: 'EVALUATION_REQUIRED' })
   const simultaneous = await Promise.all([h.owner.command('model.run', payload, { commandId }), h.owner.command('model.run', payload, { commandId })])
   assert.equal(simultaneous[0].id, simultaneous[1].id)
   const result = await h.owner.command('model.run', payload, { commandId }); assert.equal(result.status, 'proposed')
   assert.deepEqual(await h.owner.command('model.run', payload, { commandId }), result)
   const before = await h.owner.state(), row = before.models.outputs.find(r => r.id === result.id)
   assert.deepEqual([row.task, row.provider, row.model, row.playbook_version, row.simulated, row.accepted_by], [task, provider, 'synthetic-locket-1', f.playbookId, 1, null])
   const version = before.versions.find(v => v.id === row.version_id), playbook = before.playbooks.find(p => p.id === f.playbookId)
   const inputs = JSON.parse(row.input_digests)
   assert.equal(inputs.version, version.digest); assert.equal(inputs.text, digest(modelQuote)); assert.equal(inputs.playbook, digest(playbook.rules))
   assert.deepEqual(inputs.documents, before.artifacts.filter(a => a.version_id === version.id).map(a => a.sha256))
   assert.ok(inputs.documents.length > 0)
   assert.equal(calls.at(-1).provider, provider)
   assert.equal(calls.at(-1).task, task)
   const prompt = calls.at(-1).messages[0].content
   assert.equal(row.prompt_version, digest(prompt))
   assert.deepEqual(JSON.parse(row.content).proposals, [{ key: task === 'review' ? 'payment' : 'notice_days', value: task === 'review' ? 'met' : '60', quote: modelQuote }])
   assert.deepEqual([row.input_tokens, row.output_tokens, row.estimated_usd_micros], [1000, 500, 7000])
   await h.owner.command('model.accept', { outputId: result.id })
   const accepted = (await h.owner.state()).models.outputs.find(r => r.id === result.id)
   assert.equal(accepted.accepted_by, before.actor.id); assert.equal(accepted.accepted_at, Date.parse('2026-10-17T16:00:00Z'))
   assert.equal(accepted.status, 'accepted'); records.push(result.id)
  }
 }
 assert.deepEqual(calls.map(c => [c.provider, c.task]), [['anthropic','review'],['anthropic','extraction'],['openai','review'],['openai','extraction'],['workers-ai','review'],['workers-ai','extraction']])
 assert.equal(calls.length, 6)
 const state = await h.owner.state()
 assert.deepEqual(state.models.usage, { month: '2026-10', currency: 'USD', estimatedUsd: 0, simulatedEstimatedUsd: 0.042, inputTokens: 6000, outputTokens: 3000, unpriced: 0 })
 assert.deepEqual(state.terms, []); assert.deepEqual(state.deviations, [])
 assert.deepEqual(state.models.tasks.map(t => [t.task, t.status, t.available]), ['review','extraction','intake','obligations','questions','summaries','playbook-drafting','ocr'].map(task => [task, 'not evaluated', false]))
 const archive = await (await h.owner.request('/api/locket/export')).json()
 assert.deepEqual(archive.records.lk_model_outputs.map(r => r.id).sort(), records.sort())
 assert.equal(archive.records.lk_model_settings.length, 1)
 assert.equal(archive.records.lk_model_usage.length, 6)
 assert.deepEqual(archive.files, originals.files)
 for (const artifact of originals.files) {
  const response = await h.owner.request('/api/locket/files/' + artifact.id)
  assert.equal(response.status, 200)
  assert.equal(Buffer.from(await response.arrayBuffer()).toString('base64'), artifact.base64)
 }
 assert.equal(archive.records.lk_model_outputs.every(r => r.accepted_by === state.actor.id && r.simulated === 1), true)
 await h.setTime(Date.parse('2026-11-01T00:00:00Z'))
 assert.deepEqual((await h.owner.state()).models.usage, { month: '2026-11', currency: 'USD', estimatedUsd: 0, simulatedEstimatedUsd: 0, inputTokens: 0, outputTokens: 0, unpriced: 0 })
})

test('AI switches and unevaluated models refuse requests, denied people cannot configure or accept, and unsafe provider replies stay withheld', async t => {
 const { modelBindings, modelFake, modelFixture, configureModel } = await import('./model-settings-fixture.mjs')
 const calls = []; let mode = 'ok'
 const h = await installation({ bindings: modelBindings, outboundResponse: modelFake(calls, () => mode) }); t.after(() => h.close())
 await h.setTime(Date.parse('2026-10-17T16:00:00Z'))
 const f = await modelFixture(h), request = { agreementId: f.nda.id, task: 'review', consent: true, simulated: true }
 await h.owner.command('model.run', request, { error: 'AI_DISABLED' })
 await configureModel(h)
 await h.owner.command('model.run', { ...request, simulated: false }, { error: 'EVALUATION_REQUIRED' })
 await h.owner.command('model.run', { ...request, task: 'extraction', simulated: false }, { error: 'EVALUATION_REQUIRED' })
 await h.owner.command('model.run', { ...request, consent: false }, { error: 'CONSENT' })
 assert.equal(calls.length, 0)
 const good = await h.owner.command('model.run', request); assert.equal(good.status, 'proposed')
 await configureModel(h, { disabledTypes: ['nda'] })
 await h.owner.command('model.run', request, { error: 'AI_DISABLED' })
 const supplier = await h.owner.command('model.run', { ...request, agreementId: f.supplier.id }); assert.equal(supplier.status, 'proposed')
 await configureModel(h, { enabled: false })
 await h.owner.command('model.run', { ...request, agreementId: f.supplier.id }, { error: 'AI_DISABLED' })
 assert.equal(calls.length, 2)
 const viewer = await h.invite('synthetic-locket-model-viewer@example.test', 'viewer'), counsel = await h.invite('synthetic-locket-model-counsel@example.test', 'counsel')
 for (const person of [viewer, counsel]) {
  assert.equal((await person.state()).models, null)
  await person.command('model.configure', { ...(await h.owner.state()).models.settings }, { error: 'FORBIDDEN' })
  await person.command('model.run', request, { error: 'FORBIDDEN' })
  await person.command('model.accept', { outputId: good.id }, { error: 'FORBIDDEN' })
 }
 const stale = (await h.owner.state()).models.settings
 await configureModel(h, { enabled: true, disabledTypes: [], noTrainingZeroRetention: false })
 await h.owner.command('model.configure', stale, { error: 'STALE' })
 for (const provider of ['openai', 'anthropic']) {
  await configureModel(h, { provider, noTrainingZeroRetention: false })
  const count = calls.length
  await h.owner.command('model.run', request, { error: 'PROVIDER_POLICY' })
  assert.equal(calls.length, count)
 }
 await configureModel(h, { noTrainingZeroRetention: true })
 mode = 'quote'
 const invalid = await h.owner.command('model.run', request); assert.equal(invalid.status, 'uncertain')
 await h.owner.command('model.accept', { outputId: invalid.id }, { error: 'STALE' })
 mode = 'reject'
 const failed = await h.owner.command('model.run', request); assert.equal(failed.status, 'uncertain')
 const state = await h.owner.state()
 assert.equal(state.models.outputs.find(r => r.id === invalid.id).content, null)
 assert.equal(state.models.outputs.find(r => r.id === failed.id).content, null)
 assert.equal(state.models.usage.simulatedEstimatedUsd, 0.021)
 assert.equal(state.models.usage.unpriced, 1)
 assert.equal(state.models.outputs.filter(r => r.accepted_by).length, 0)
 assert.equal(state.models.tasks.find(t => t.task === 'review').available, false)
 assert.equal(state.models.tasks.find(t => t.task === 'review').status, 'not evaluated')
 const noSimulation = await installation(); t.after(() => noSimulation.close())
 const native = await modelFixture(noSimulation); await configureModel(noSimulation)
 await noSimulation.owner.command('model.run', { ...request, agreementId: native.nda.id }, { error: 'SIMULATION_UNAVAILABLE' })
 await noSimulation.owner.command('model.run', { ...request, agreementId: native.nda.id, simulated: false }, { error: 'EVALUATION_REQUIRED' })
 await modelCompletionRaces()
})

async function modelCompletionRaces() {
 const { modelBindings, modelFake, modelFixture, configureModel, modelQuote } = await import('./model-settings-fixture.mjs')
 const { file, pdf } = await import('./setup.mjs')
 const { randomUUID } = await import('node:crypto')
 // One completion-refusal behaviour, exercised through each mutable binding.
 for (const changed of ['session', 'role', 'source', 'playbook', 'settings']) {
  const calls = [], entered = Promise.withResolvers(), release = Promise.withResolvers()
  const fake = modelFake(calls)
  const h = await installation({ bindings: modelBindings, outboundResponse: async request => {
   const response = await fake(request)
   entered.resolve(); await release.promise
   return response
  } })
  try {
   await h.setTime(Date.parse('2026-10-17T16:00:00Z'))
   const f = await modelFixture(h); await configureModel(h)
   const firstOwner = h.owner, ownerId = (await firstOwner.state()).actor.id
   let observer = firstOwner
   const stepUp = async client => {
    const sent = await client.request('/auth/step-up', { method: 'POST', body: { action: 'owner:transfer' } })
    assert.equal(sent.status, 202)
    const link = new URL(h.mails.at(-1).text.match(/https?:\/\/[^\s]+/)[0])
    const confirmed = await client.request('/auth/confirm', { method: 'POST', body: { token: link.searchParams.get('token') } })
    assert.equal(confirmed.status, 303)
   }
   if (changed === 'role') {
    observer = await h.invite('synthetic-locket-model-owner@example.test', 'viewer')
    await stepUp(firstOwner)
    const promoted = await firstOwner.request('/auth/operator/role', { method: 'POST', body: { operatorId: observer.id, role: 'owner' } })
    assert.equal(promoted.status, 200, await promoted.text())
    observer = await h.signIn('synthetic-locket-model-owner@example.test')
    await stepUp(observer)
   }
   const commandId = randomUUID(), payload = { agreementId: f.supplier.id, task: 'review', consent: true, simulated: true }
   const pending = firstOwner.command('model.run', payload, { commandId })
   let timer
   try { await Promise.race([entered.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Provider dispatch did not arrive')), 10000) })]) }
   finally { clearTimeout(timer) }
   const before = await (await observer.request('/api/locket/export')).json()
   assert.equal(before.records.lk_model_outputs.length, 1)
   const row = before.records.lk_model_outputs[0]
   assert.deepEqual([row.status, row.content, row.input_tokens, row.output_tokens, row.estimated_usd_micros], ['uncertain', null, null, null, null])
   if (changed === 'session') {
    const out = await firstOwner.request('/auth/signout', { method: 'POST', body: {} }); assert.equal(out.status, 204)
    observer = await h.signIn('owner@example.test')
   } else if (changed === 'role') {
    const out = await observer.request('/auth/operator/role', { method: 'POST', body: { operatorId: ownerId, role: 'member' } })
    assert.equal(out.status, 200, await out.text())
   } else if (changed === 'source') {
    const a = (await observer.state()).agreements.find(a => a.id === f.supplier.id)
    await observer.command('version.upload', { agreementId: a.id, version: a.version, kind: 'upload', file: file('synthetic-locket-3.pdf', pdf(modelQuote + ' Revised.')), text: modelQuote + ' Revised.' })
   } else if (changed === 'playbook') {
    const revised = await observer.command('playbook.draft', { rules: [{ key: 'payment', title: 'Revised terms', preferred: 'Invoices payable within 15 days.', alternatives: [], authority: 'counsel' }] })
    await observer.command('playbook.activate', { id: revised.id })
   } else await configureModel(h, { enabled: false })
   release.resolve()
   assert.equal((await pending).status, 'uncertain', changed)
   const after = await (await observer.request('/api/locket/export')).json()
   for (const table of ['lk_model_outputs', 'lk_model_usage']) assert.deepEqual(after.records[table], before.records[table], `${changed}: retained ${table} unchanged`)
   assert.deepEqual(after.records.lk_audit.filter(a => a.command_id === commandId), before.records.lk_audit.filter(a => a.command_id === commandId), changed)
   assert.equal(calls.length, 1)
   await observer.command('model.accept', { outputId: row.id }, { error: 'STALE' })
   const state = await observer.state()
   assert.equal(state.models.usage.unpriced, 1)
   assert.equal(state.models.usage.simulatedEstimatedUsd, 0)
   assert.deepEqual(state.terms, []); assert.deepEqual(state.deviations, [])
  } finally { release.resolve(); await h.close() }
 }
}
