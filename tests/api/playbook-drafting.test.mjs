import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID, createHash } from 'node:crypto'
import { installation } from './harness.mjs'
import { draftingFixture, draftingFake, draftRecord, reviewDraft, modelBindings, scope, preferred } from './playbook-drafting-fixture.mjs'
import { configureModel } from './model-settings-fixture.mjs'
import { file, pdf } from './files.mjs'
import { find } from './analytics-fixture.mjs'

test('PLAY-002 drafts from two approved templates and twenty executed agreements, retains six accepted/two edited/one rejected decisions, and counsel alone approves exact future scope without rewriting history', async () => {
 const calls = [], modelCalls = []; let mode = 'ok', during = async () => {}, duringModel = async () => {}
 const fake = draftingFake(calls, () => mode, () => during())
 const h = await installation({ bindings: modelBindings, outboundResponse: async request => {
  const body = await request.clone().json()
  if (body.max_tokens === 12000) return fake(request)
  assert.equal(request.url, 'https://api.openai.com/v1/chat/completions')
  assert.match(body.messages[0].content, /^locket-review-v1:/)
  const input = JSON.parse(body.messages.at(-1).content)
  modelCalls.push(input)
  await duringModel()
  return Response.json({ choices: [{ message: { content: JSON.stringify({ proposals: [{ key: 'topic0', value: 'met', quote: input.text }] }) } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } })
 } })
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
  assert.equal((await h.owner.state()).models.usage.simulatedEstimatedUsd, 0.007)
  // Exercise actual model review, human findings and clause provenance through
  // the public doors, including superseded type/entity fallback playbooks.
  const proveFuture = async (type, entityId, expected) => {
   const future = await h.owner.command('request.create', { title: `Future ${type} ${entityId || 'all entities'}`, type, ...(entityId ? { entityId } : {}), party: { name: 'Synthetic future supplier', kind: 'supplier' }, file: file('future.pdf', pdf('Future terms')), text: 'Future terms' })
   assert.equal((await f.counsel.state()).agreementPlaybooks[future.id], expected)
   const finding = await f.counsel.command('deviation.add', { agreementId: future.id, versionId: future.versionId, clauseKey: 'topic0', result: 'met', start: 0, end: 12, quote: 'Future terms', explanation: 'Human review uses the currently applicable scoped rule.', questions: [] })
   assert.equal((await f.counsel.state()).deviations.find(d => d.id === finding.id).playbook_version_id, expected)
   await h.owner.command('clause.insert', { agreementId: future.id, version: (await find(h.owner, future.id)).version, versionId: future.versionId, libraryVersionId: f.templates[0].versionId, clauseKey: 'topic0', variantId: 'standard', start: 12, end: 12, quote: '' })
   const current = await find(h.owner, future.id), state = await h.owner.state()
   const version = state.versions.find(v => v.id === current.current_version_id)
   assert.equal(JSON.parse(version.fields).clauseLibrary[0].playbookVersionId, expected)
   const output = await h.owner.command('model.run', { agreementId: future.id, task: 'review', simulated: true, consent: true })
   assert.equal(output.status, 'proposed')
   const row = (await h.owner.state()).models.outputs.find(o => o.id === output.id)
   assert.equal(row.playbook_version, expected)
   assert.deepEqual(modelCalls.at(-1).rules, JSON.parse(state.playbooks.find(p => p.id === expected).rules))
   assert.equal(modelCalls.at(-1).text, version.text)
   await h.owner.command('model.accept', { outputId: output.id })
   return future
  }
  for (const type of ['supplier', 'nda']) {
   await proveFuture(type, null, type === 'supplier' ? approved.playbookId : f.source.id)
  }
  const archive = await (await h.owner.request('/api/locket/export')).json()
  const retained = archive.records.lk_playbook_drafts.find(r => r.id === d.id)
  assert.equal(retained.session_id, ''); assert.equal(retained.approved_by, f.counsel.id)
  assert.equal(JSON.parse(retained.proposals).length, 9)
  assert.equal(archive.records.lk_playbook_draft_applications.find(r => r.id === book.id).scope, JSON.stringify(scope))
  assert.ok(archive.records.lk_audit.some(a => a.action === 'playbook.generated.approve'))
  // A second explicit scope proves entity fallback through the same public door.
  const entities = []
  for (const legalName of ['Synthetic US parent', 'Synthetic US subsidiary']) entities.push(await h.owner.command('entity.save', { legalName, entityType: 'Corporation', formation: 'Delaware, United States', registeredAddress: '100 Synthetic Street', noticeAddress: 'Legal, 100 Synthetic Street', currency: 'USD', timezone: 'America/New_York', signatories: [] }))
  await h.owner.command('agreement.entity', { agreementId: history.id, version: (await find(h.owner, history.id)).version, entityId: entities[0].id })
  const entityScope = { ...scope, entityIds: [entities[0].id] }
  const scopedDraft = await f.counsel.command('playbook.generate', { ...f.payload, agreementIds: [history.id], scope: entityScope })
  const scopedReview = await reviewDraft(f, scopedDraft.id)
  const scopedBook = await f.counsel.command('playbook.generation.approve', { draftId: scopedDraft.id, revision: scopedReview.revision, scope: entityScope, consent: true, reason: 'Apply only to the named parent, preserving the subsidiary playbook.' })
  for (const entity of entities) {
   await proveFuture('supplier', entity.id, entity.id === entities[0].id ? scopedBook.playbookId : approved.playbookId)
  }
  await f.counsel.command('playbook.recommend', { sourcePlaybookId: scopedBook.playbookId, clauseKey: 'topic0', scope }, { error: 'SCOPE' })
  // Negotiation and operational records do not change the agreement revision.
  // Both reviewed approvals and in-flight provider completions must still stop.
  const outcomePayload = async a => ({ agreementId: a.id, version: (await find(h.owner, a.id)).version, versionId: a.versionId, deviationId: a.exception.id, approvalId: a.exceptionApproval.id, outcome: 'accepted', evidence: 'Synthetic counterparty reply expressly accepts the quoted exact-version exception.' })
  const newReviewedDraft = async (payload = f.payload) => {
   const result = await f.counsel.command('playbook.generate', payload)
   assert.equal(result.status, 'proposed')
   return reviewDraft(f, result.id)
  }
  const approveDraft = (draft, error) => f.counsel.command('playbook.generation.approve', { draftId: draft.id, revision: draft.revision, scope, consent: true, reason: 'Approve only a fresh analysis including every selected-source observation.' }, error ? { error } : {})
  const observed = f.agreements[1], revision = (await find(h.owner, observed.id)).version
  let outdated = await newReviewedDraft()
  const outcome = await f.counsel.command('negotiation.outcome.record', await outcomePayload(observed))
  assert.equal((await find(h.owner, observed.id)).version, revision)
  await approveDraft(outdated, 'STALE')
  await f.counsel.command('playbook.generation.decide', { draftId: outdated.id, revision: outdated.revision, ruleKey: 'topic0', decision: 'accept', reason: 'A new observation needs fresh analysis.' }, { error: 'STALE' })
  outdated = await newReviewedDraft()
  const analyzed = calls.at(-1).input.sources.find(s => s.id === observed.id).facts.observations
  assert.equal(analyzed.lk_negotiation_outcomes[0].id, outcome.id)
  const issue = kind => f.counsel.command('playbook.issue.record', { agreementId: observed.id, version: revision, outcomeId: outcome.id, kind, description: `Synthetic later ${kind} observation.`, evidence: 'A separately recorded observation, never inferred from signing.' })
  await issue('dispute')
  assert.equal((await find(h.owner, observed.id)).version, revision)
  await approveDraft(outdated, 'STALE')
  during = async () => { during = async () => {}; await issue('credit') }
  const interruptedId = randomUUID()
  const interrupted = await f.counsel.command('playbook.generate', f.payload, { commandId: interruptedId })
  assert.equal(interrupted.status, 'uncertain')
  let attempts = calls.length
  assert.deepEqual(await f.counsel.command('playbook.generate', f.payload, { commandId: interruptedId }), interrupted)
  assert.equal(calls.length, attempts)
  during = async () => { during = async () => {}; await f.counsel.command('negotiation.outcome.record', await outcomePayload(f.agreements[2])) }
  assert.equal((await f.counsel.command('playbook.generate', f.payload)).status, 'uncertain')
  // An unselected agreement's later observation does not stale this analysis.
  const isolated = await newReviewedDraft({ ...f.payload, agreementIds: [history.id] })
  await issue('none_observed')
  await approveDraft(isolated)
  // A global activation during review is harmless when the resolved scope is
  // unchanged; an applicable change withholds content and never resends.
  let fresh = await newReviewedDraft()
  const nda = await h.owner.command('request.create', { title: 'Concurrent out-of-scope NDA', type: 'nda', entityId: entities[1].id, party: { name: 'Synthetic NDA party', kind: 'supplier' }, file: file('nda.pdf', pdf('Future terms')), text: 'Future terms' })
  duringModel = async () => { duringModel = async () => {}; await approveDraft(fresh) }
  const preserved = await h.owner.command('model.run', { agreementId: nda.id, task: 'review', simulated: true, consent: true })
  assert.equal(preserved.status, 'proposed')
  assert.equal((await h.owner.state()).models.outputs.find(o => o.id === preserved.id).playbook_version, f.source.id)
  fresh = await newReviewedDraft()
  assert.equal(calls.at(-1).input.sources.find(s => s.id === observed.id).facts.observations.lk_playbook_issues.length, 3)
  const supplier = await h.owner.command('request.create', { title: 'Concurrent in-scope supplier', type: 'supplier', entityId: entities[1].id, party: { name: 'Synthetic supplier party', kind: 'supplier' }, file: file('supplier.pdf', pdf('Future terms')), text: 'Future terms' })
  duringModel = async () => { duringModel = async () => {}; await approveDraft(fresh) }
  const reviewCommand = randomUUID(), reviewPayload = { agreementId: supplier.id, task: 'review', simulated: true, consent: true }
  const withheldReview = await h.owner.command('model.run', reviewPayload, { commandId: reviewCommand })
  assert.equal(withheldReview.status, 'uncertain')
  attempts = modelCalls.length
  assert.deepEqual(await h.owner.command('model.run', reviewPayload, { commandId: reviewCommand }), withheldReview)
  assert.equal(modelCalls.length, attempts)
  assert.equal((await h.owner.state()).models.outputs.find(o => o.id === withheldReview.id).content, null)
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
  assert.equal(uncertain.length, 5)
  const count = calls.length
  await f.counsel.command('playbook.generate', payload, { commandId: revokedCommand, error: 'FORBIDDEN' })
  assert.equal(calls.length, count)
  await h.owner.command('role.set', { operatorId: f.counsel.id, role: 'counsel' })
  during = async () => { assert.equal((await f.counsel.request('/auth/signout', { method: 'POST', body: {} })).status, 204) }
  await f.counsel.command('playbook.generate', payload, { error: 'AUTHORITY' })
  assert.equal((await f.counsel.request('/api/locket/state')).status, 401)
 } finally { await h.close() }
})
