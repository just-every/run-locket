import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID, createHash } from 'node:crypto'
import { installation } from './harness.mjs'
import { draftingFixture, draftingFake, draftRecord, reviewDraft, modelBindings, scope, preferred } from './playbook-drafting-fixture.mjs'
import { configureModel } from './model-settings-fixture.mjs'
import { file, pdf } from './files.mjs'
import { find } from './analytics-fixture.mjs'

test('PLAY-002 drafts from two approved templates and twenty executed agreements, retains six accepted/two edited/one rejected decisions, and counsel alone approves exact future scope without rewriting history', async () => {
 const calls = []; let mode = 'ok', during = async () => {}
 const h = await installation({ bindings: modelBindings, outboundResponse: draftingFake(calls, () => mode, () => during()) })
 try {
  const f = await draftingFixture(h), viewer = await h.invite('synthetic-locket-drafting-viewer@example.test', 'viewer')
  const stateBefore = await h.owner.state(), history = stateBefore.agreements.find(a => a.id === f.agreements[0].id)
  const digest = bytes => createHash('sha256').update(bytes).digest('hex')
  const original = Buffer.from(await (await h.owner.request('/api/locket/files/' + f.agreements[0].package.pdfArtifactId)).arrayBuffer())
  assert.equal((await viewer.state()).playbookDrafting, null)
  await viewer.command('playbook.generate', f.payload, { error: 'FORBIDDEN' })
  await h.owner.command('playbook.generate', f.payload, { error: 'FORBIDDEN' })
  await f.counsel.command('playbook.generate', { ...f.payload, simulated: false }, { error: 'EVALUATION_REQUIRED' })
  await f.counsel.command('playbook.generate', { ...f.payload, consent: false }, { error: 'CONSENT' })
  await configureModel(h, { disabledTypes: ['supplier'] })
  await f.counsel.command('playbook.generate', f.payload, { error: 'AI_DISABLED' })
  await configureModel(h, { disabledTypes: [], noTrainingZeroRetention: false })
  await f.counsel.command('playbook.generate', f.payload, { error: 'PROVIDER_POLICY' })
  await configureModel(h, { noTrainingZeroRetention: true })
  assert.equal(calls.length, 0)
  const commandId = randomUUID()
  const result = await f.counsel.command('playbook.generate', f.payload, { commandId })
  assert.equal(result.status, 'proposed')
  assert.deepEqual(await f.counsel.command('playbook.generate', f.payload, { commandId }), result)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].input.sources.filter(s => s.kind === 'template').length, 2)
  assert.equal(calls[0].input.sources.filter(s => s.kind === 'agreement').length, 20)
  let d = await draftRecord(f, result.id), rules = JSON.parse(d.proposals)
  assert.equal(rules.length, 9)
  assert.ok(rules.flatMap(r => r.citations).some(c => c.kind === 'template' && c.artifactId && /^[a-f0-9]{64}$/.test(c.artifactDigest)))
  assert.equal(new Set(rules.flatMap(r => r.citations.filter(c => c.kind === 'agreement').map(c => c.id))).size, 20)
  assert.equal((await h.owner.state()).playbooks.find(p => p.status === 'active').id, f.source.id)
  await f.counsel.command('playbook.generation.approve', { draftId: d.id, revision: d.revision, scope, consent: true, reason: 'Premature approval is refused.' }, { error: 'RULE_DECISIONS' })
  await viewer.command('playbook.generation.decide', { draftId: d.id, revision: d.revision, ruleKey: 'topic0', decision: 'accept', reason: 'Denied.' }, { error: 'FORBIDDEN' })
  d = await reviewDraft(f, d.id)
  rules = JSON.parse(d.proposals)
  assert.deepEqual(['accept', 'edit', 'reject'].map(v => rules.filter(r => r.decision === v).length), [6, 2, 1])
  assert.equal(rules[6].proposed.preferred, preferred[6]); assert.match(rules[6].effective.preferred, /^Counsel edited/)
  assert.ok(rules.every(r => r.decidedBy === f.counsel.id && r.decidedAt && r.reason && r.history.length === 1))
  await f.counsel.command('playbook.generation.approve', { draftId: d.id, revision: d.revision, scope: { ...scope, agreementTypes: ['nda'] }, consent: true, reason: 'Changed scope is refused.' }, { error: 'SCOPE' })
  await f.counsel.command('playbook.generation.decide', { draftId: d.id, revision: 1, ruleKey: 'topic0', decision: 'reject', reason: 'Stale.' }, { error: 'STALE' })
  const approved = await f.counsel.command('playbook.generation.approve', { draftId: d.id, revision: d.revision, scope, consent: true, reason: 'Reviewed every rule; publish eight rules for future supplier use only.' })
  const after = await f.counsel.state(), book = after.playbooks.find(b => b.id === approved.playbookId)
  assert.equal(book.status, 'active'); assert.equal(JSON.parse(book.rules).length, 8)
  assert.equal(JSON.parse(book.rules)[6].authority, 'counsel'); assert.match(JSON.parse(book.rules)[6].preferred, /^Counsel edited/)
  assert.equal(after.deviations.find(v => v.id === f.agreements[0].finding.id).playbook_version_id, f.source.id)
  assert.deepEqual(after.approvals.find(a => a.id === f.agreements[0].approval.id), stateBefore.approvals.find(a => a.id === f.agreements[0].approval.id))
  assert.deepEqual(after.agreements.find(a => a.id === history.id), history)
  assert.equal(digest(Buffer.from(await (await h.owner.request('/api/locket/files/' + f.agreements[0].package.pdfArtifactId)).arrayBuffer())), digest(original))
  for (const type of ['supplier', 'nda']) {
   const future = await h.owner.command('request.create', { title: `Future ${type}`, type, party: { name: 'Synthetic future supplier', kind: 'supplier' }, file: file('future.pdf', pdf('Future terms')), text: 'Future terms' })
   assert.equal((await f.counsel.state()).agreementPlaybooks[future.id], type === 'supplier' ? approved.playbookId : f.source.id)
  }
  const archive = await (await h.owner.request('/api/locket/export')).json()
  const retained = archive.records.lk_playbook_drafts.find(r => r.id === d.id)
  assert.equal(retained.session_id, ''); assert.equal(retained.approved_by, f.counsel.id)
  assert.equal(JSON.parse(retained.proposals).length, 9)
  assert.equal(archive.records.lk_playbook_draft_applications.find(r => r.id === book.id).scope, JSON.stringify(scope))
  assert.ok(archive.records.lk_audit.some(a => a.action === 'playbook.generated.approve'))
  assert.equal((await h.owner.state()).models.usage.simulatedEstimatedUsd, 0.007)
  // A second explicit scope proves entity fallback through the same public door.
  const entities = []
  for (const legalName of ['Synthetic US parent', 'Synthetic US subsidiary']) entities.push(await h.owner.command('entity.save', { legalName, entityType: 'Corporation', formation: 'Delaware, United States', registeredAddress: '100 Synthetic Street', noticeAddress: 'Legal, 100 Synthetic Street', currency: 'USD', timezone: 'America/New_York', signatories: [] }))
  await h.owner.command('agreement.entity', { agreementId: history.id, version: (await find(h.owner, history.id)).version, entityId: entities[0].id })
  const entityScope = { ...scope, entityIds: [entities[0].id] }
  const scopedDraft = await f.counsel.command('playbook.generate', { ...f.payload, agreementIds: [history.id], scope: entityScope })
  const scopedReview = await reviewDraft(f, scopedDraft.id)
  const scopedBook = await f.counsel.command('playbook.generation.approve', { draftId: scopedDraft.id, revision: scopedReview.revision, scope: entityScope, consent: true, reason: 'Apply only to the named parent, preserving the subsidiary playbook.' })
  for (const entity of entities) {
   const future = await h.owner.command('request.create', { title: `Future ${entity.id}`, type: 'supplier', entityId: entity.id, party: { name: 'Synthetic future counterparty', kind: 'supplier' } })
   assert.equal((await f.counsel.state()).agreementPlaybooks[future.id], entity.id === entities[0].id ? scopedBook.playbookId : approved.playbookId)
  }
  await f.counsel.command('playbook.recommend', { sourcePlaybookId: scopedBook.playbookId, clauseKey: 'topic0', scope }, { error: 'SCOPE' })
  // The same public journey exercises all supported provider envelopes and
  // withholds unsafe responses, changed sources and revoked authorizers.
  for (const provider of ['anthropic', 'workers-ai']) {
   await configureModel(h, { provider })
   const r = await f.counsel.command('playbook.generate', f.payload)
   assert.equal(r.status, 'proposed'); assert.equal(calls.at(-1).provider, provider)
  }
  for (const failure of ['quote', 'source', 'fallback', 'reject']) {
   mode = failure
   const r = await f.counsel.command('playbook.generate', f.payload)
   assert.equal(r.status, 'failed'); assert.equal(JSON.parse((await draftRecord(f, r.id)).proposals).length, 0)
  }
  mode = 'ok'
  let stale = await f.counsel.command('playbook.generate', f.payload)
  await f.counsel.command('template.decide', { versionId: f.templates[0].versionId, decision: 'retire' })
  await f.counsel.command('playbook.generation.decide', { draftId: stale.id, revision: 1, ruleKey: 'topic0', decision: 'accept', reason: 'Retired source is refused.' }, { error: 'SOURCES' })
  const payload = { ...f.payload, templateVersionIds: [f.templates[1].versionId] }
  stale = await f.counsel.command('playbook.generate', payload)
  const a = await find(h.owner, f.agreements[1].id)
  await h.owner.command('access.set', { agreementId: a.id, operatorId: viewer.id, grant: 'grant' })
  await f.counsel.command('playbook.generation.decide', { draftId: stale.id, revision: 1, ruleKey: 'topic0', decision: 'accept', reason: 'Changed source is refused.' }, { error: 'STALE' })
  during = async () => { await configureModel(h, { inputUsdPerMillion: 3 }) }
  let withheld = await f.counsel.command('playbook.generate', payload)
  assert.equal(withheld.status, 'uncertain')
  during = async () => { await h.owner.command('access.set', { agreementId: f.agreements[2].id, operatorId: viewer.id, grant: 'grant' }) }
  withheld = await f.counsel.command('playbook.generate', payload)
  assert.equal(withheld.status, 'uncertain')
  during = async () => { await h.owner.command('role.set', { operatorId: f.counsel.id, role: 'viewer' }) }
  const revokedCommand = randomUUID()
  await f.counsel.command('playbook.generate', payload, { commandId: revokedCommand, error: 'AUTHORITY' })
  const uncertain = (await (await h.owner.request('/api/locket/export')).json()).records.lk_playbook_drafts.filter(r => r.status === 'uncertain')
  assert.equal(uncertain.length, 3)
  const count = calls.length
  await f.counsel.command('playbook.generate', payload, { commandId: revokedCommand, error: 'FORBIDDEN' })
  assert.equal(calls.length, count)
  await h.owner.command('role.set', { operatorId: f.counsel.id, role: 'counsel' })
  during = async () => { assert.equal((await f.counsel.request('/auth/signout', { method: 'POST', body: {} })).status, 204) }
  await f.counsel.command('playbook.generate', payload, { error: 'AUTHORITY' })
  assert.equal((await f.counsel.request('/api/locket/state')).status, 401)
 } finally { await h.close() }
})
