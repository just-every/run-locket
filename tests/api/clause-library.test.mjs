import assert from 'node:assert/strict'
import test from 'node:test'
import { installation } from './harness.mjs'
import { file, pdf, docx } from './files.mjs'

const wording = {
  preferred: 'Each party indemnifies the other for its negligence.',
  fallback1: 'Each party indemnifies the other for its gross negligence.',
  fallback2: 'Each party indemnifies the other for its wilful misconduct.',
  'walk-away': 'Neither party provides an indemnity.',
}
const clauses = [{ key: 'indemnity', title: 'Indemnity', notes: 'Use mutual indemnity for mutual risk.', ruleKey: 'indemnity', variants: Object.entries(wording).map(([id, text]) => ({ id, label: id, text, notes: id === 'fallback1' ? 'Use if the preferred wording is rejected.' : '' })) }]
async function library(h, approve = true) {
  const template = await h.owner.command('template.create', { name: 'Negotiation clauses', type: 'nda', body: 'NDA\n[[clause:indemnity]]', fields: [], clauses })
  if (approve) await h.owner.command('template.decide', { versionId: template.versionId, decision: 'approve' })
  const playbook = await h.owner.command('playbook.draft', { rules: [{ key: 'indemnity', title: 'Mutual indemnity', preferred: wording.preferred, alternatives: [wording.fallback1, wording.fallback2, wording['walk-away']], authority: 'counsel', guidance: 'Escalate non-mutual risk.' }] })
  await h.owner.command('playbook.activate', { id: playbook.id })
  return { ...template, playbookId: playbook.id }
}
const readClauses = async client => (await (await client.request('/api/locket/clause-library?q=indemnity')).json()).results
const agreement = async (client, id) => (await client.state()).agreements.find(a => a.id === id)
async function create(h, body = 'NDA\nIndemnity remains to be agreed.') {
  return h.owner.command('request.create', { title: 'Mutual NDA', type: 'nda', party: { name: 'Example customer', kind: 'customer' }, file: file('negotiation.docx', docx(body.split('\n'))) })
}
async function insert(h, lib, id, variantId = 'fallback1') {
  const a = await agreement(h.owner, id)
  const s = await h.owner.state(), base = s.versions.find(v => v.id === a.current_version_id)
  const quote = 'Indemnity remains to be agreed.', start = base.text.indexOf(quote)
  return h.owner.command('clause.insert', { agreementId: id, version: a.version, versionId: base.id, libraryVersionId: lib.versionId, clauseKey: 'indemnity', variantId, start, end: start + quote.length, quote })
}
async function execute(h, id) {
  let a = await agreement(h.owner, id)
  if (a.status === 'draft') await h.owner.command('agreement.submit', { agreementId: id, version: a.version })
  a = await agreement(h.owner, id)
  await h.owner.command('approval.decide', { agreementId: id, version: a.version, versionId: a.current_version_id, kind: 'commercial', decision: 'approved' })
  a = await agreement(h.owner, id)
  const pkg = await h.owner.command('package.prepare', { agreementId: id, version: a.version, provider: 'docusign', recipients: [{ name: 'Alex', email: 'alex@example.test', action: 'sign' }] })
  a = await agreement(h.owner, id)
  const envelopeId = `ENV-${id}`
  await h.owner.command('package.sent', { agreementId: id, version: a.version, packageId: pkg.packageId, envelopeId })
  a = await agreement(h.owner, id)
  await h.owner.command('execution.record', { agreementId: id, version: a.version, envelopeId, executedOn: '2026-10-19', documentConfirmed: true, signers: [{ name: 'Alex', email: 'alex@example.test' }], signed: file('signed.pdf', pdf(`Signed ${id}`)), certificate: file('certificate.pdf', pdf(`Certificate ${id}`)) })
}

test('DRAFT-003 searches approved variants and records insertion provenance through execution and export', async t => {
  const h = await installation(); t.after(() => h.close())
  const lib = await library(h)
  let results = await readClauses(h.owner)
  assert.deepEqual(new Set(results.map(r => r.variantId)), new Set(Object.keys(wording)))
  const fallback = results.find(r => r.variantId === 'fallback1')
  assert.match(fallback.notes, /preferred wording is rejected/)
  assert.equal(fallback.rule.key, 'indemnity')
  assert.equal(fallback.playbookVersionId, lib.playbookId)
  const request = await create(h)
  const before = await h.owner.state(), original = before.artifacts.find(f => f.version_id === request.versionId)
  const bytes = Buffer.from(await (await h.owner.request(`/api/locket/files/${original.id}`)).arrayBuffer())
  const inserted = await insert(h, lib, request.id)
  let state = await h.owner.state(), version = state.versions.find(v => v.id === inserted.versionId)
  assert.match(version.text, /gross negligence/)
  const use = JSON.parse(version.fields).clauseLibrary[0]
  assert.equal(use.libraryVersionId, lib.versionId)
  assert.equal(use.variantId, 'fallback1')
  assert.equal(use.text, wording.fallback1)
  assert.equal(use.playbookVersionId, lib.playbookId)
  assert.equal((await readClauses(h.owner)).find(r => r.variantId === 'fallback1').acceptanceCount, 0)
  await execute(h, request.id)
  assert.equal((await readClauses(h.owner)).find(r => r.variantId === 'fallback1').acceptanceCount, 1)
  assert.equal((await readClauses(h.owner)).find(r => r.variantId === 'preferred').acceptanceCount, 0)
  assert.deepEqual(Buffer.from(await (await h.owner.request(`/api/locket/files/${original.id}`)).arrayBuffer()), bytes)
  const exported = await (await h.owner.request('/api/locket/export')).json()
  assert.deepEqual(JSON.parse(exported.records.lk_versions.find(v => v.id === inserted.versionId).fields).clauseLibrary, [use])
  assert.ok((await h.owner.state()).audit.some(e => e.action === 'clause.insert' && e.agreement_id === request.id))
})

test('DRAFT-003 counts retained template selections and negotiation insertions in the executed current version', async t => {
  const h = await installation(); t.after(() => h.close())
  const lib = await library(h)
  const untouched = await h.owner.command('request.create', { title: 'Template choice', type: 'nda', party: { name: 'Example customer', kind: 'customer' }, templateVersionId: lib.versionId, fields: {}, clauseChoices: { indemnity: 'fallback1' } })
  await execute(h, untouched.id)
  assert.equal((await readClauses(h.owner)).find(r => r.variantId === 'fallback1').acceptanceCount, 1)
  const retained = await create(h)
  await insert(h, lib, retained.id)
  let a = await agreement(h.owner, retained.id)
  await h.owner.command('version.upload', { agreementId: a.id, version: a.version, kind: 'counterparty', file: file('retained.pdf', pdf('Counterparty retained clause')), text: `NDA amended\n${wording.fallback1}` })
  await execute(h, retained.id)
  assert.equal((await readClauses(h.owner)).find(r => r.variantId === 'fallback1').acceptanceCount, 2)
  const removed = await create(h)
  await insert(h, lib, removed.id)
  a = await agreement(h.owner, removed.id)
  await h.owner.command('version.upload', { agreementId: a.id, version: a.version, kind: 'counterparty', file: file('removed.pdf', pdf('Indemnity removed')), text: 'NDA amended. No indemnity agreed.' })
  await execute(h, removed.id)
  assert.equal((await readClauses(h.owner)).find(r => r.variantId === 'fallback1').acceptanceCount, 2)
})

test('DRAFT-003 enforces approval, authority, current-version and citation guards', async t => {
  const h = await installation(); t.after(() => h.close())
  const lib = await library(h, false), request = await create(h)
  const a = await agreement(h.owner, request.id)
  const base = (await h.owner.state()).versions.find(v => v.id === a.current_version_id)
  const payload = { agreementId: a.id, version: a.version, versionId: base.id, libraryVersionId: lib.versionId, clauseKey: 'indemnity', variantId: 'fallback1', start: 0, end: 0, quote: '' }
  assert.deepEqual(await readClauses(h.owner), [])
  await h.owner.command('clause.insert', payload, { error: 'TEMPLATE_NOT_APPROVED' })
  await h.owner.command('template.decide', { versionId: lib.versionId, decision: 'approve' })
  await h.owner.command('clause.insert', { ...payload, end: 3, quote: 'not the text' }, { error: 'CITATION' })
  const viewer = await h.invite('viewer@example.test', 'viewer')
  await viewer.command('clause.insert', payload, { error: 'FORBIDDEN' })
  await h.owner.command('clause.insert', payload)
  await h.owner.command('clause.insert', payload, { error: 'NOT_CURRENT' })
  const current = await agreement(h.owner, a.id)
  await h.owner.command('clause.insert', { ...payload, versionId: current.current_version_id }, { error: 'STALE' })
  await h.owner.command('template.decide', { versionId: lib.versionId, decision: 'retire' })
  assert.deepEqual(await readClauses(h.owner), [])
})
