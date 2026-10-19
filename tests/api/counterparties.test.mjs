import assert from 'node:assert/strict'
import test from 'node:test'
import { installation } from './harness.mjs'
import { team } from './setup.mjs'
import { file, pdf } from './files.mjs'

const quote = 'This agreement runs from January 1, 2026 to December 31, 2027.'
const acme = {
  name: 'Acme Robotics, Inc.', kind: 'supplier', entityType: 'Corporation', formation: 'Delaware', taxIdKind: 'ein', taxId: '98-7654321', email: 'legal@acme.example',
  registeredAddress: '251 Little Falls Drive, Wilmington, DE 19808', noticeAddress: 'General Counsel, 1 Market Street, San Francisco, CA 94105', noticeMethod: 'courier',
  contacts: [{ name: 'Pat Lee', email: 'pat@acme.example', title: 'Contracts manager' }], signatories: [{ name: 'Jordan Diaz', email: 'jordan@acme.example', title: 'Chief Financial Officer' }],
}

test('REPO-010 counterparty details, notice address and signatories, three linked agreements by family, contracted and annual USD, next deadline, and merging an intake duplicate', async t => {
  const h = await installation(); t.after(() => h.close())
  const people = await team(h), viewer = await h.invite('viewer@example.test', 'viewer')
  await people.requester.command('party.save', { ...acme, signatories: [{ name: 'Jordan Diaz', email: 'jordan@acme.example' }] }, { error: 'INVALID' })
  await people.requester.command('party.save', { ...acme, noticeMethod: 'fax' }, { error: 'INVALID' })
  const kept = await people.requester.command('party.save', acme)
  let s = await viewer.state()

  // Three agreements link to it: an imported MSA with confirmed dates, its amendment (no dates) and a draft request.
  const imported = (title, value, extra = {}) => h.owner.command('legacy.import', { title, type: 'supplier', partyId: kept.id, value, sourceSystem: 'Shared drive', sourceId: `contracts/${title}.pdf`, signed: true, text: quote, file: file(`${title}.pdf`, pdf(`${title} ${quote}`)), ...extra })
  const msa = await imported('Acme MSA', '120000')
  const amendment = await imported('Acme amendment 1', '50000')
  const hidden = await imported('Acme restricted pilot', '10000', { restricted: true })
  const draft = await people.requester.command('request.create', { title: 'Acme spares order', type: 'nda', partyId: kept.id, value: '9000' })
  for (const [key, value] of [['effective_date', '2026-01-01'], ['end_date', '2027-12-31'], ['notice_days', '60'], ['auto_renew', 'no']]) {
    const term = await h.owner.command('term.propose', { agreementId: msa.id, key, value, citation: { quote } })
    await h.owner.command('term.decide', { agreementId: msa.id, termId: term.id, decision: 'confirm' })
  }
  const amendmentRow = (await h.owner.state()).agreements.find(a => a.id === amendment.id)
  await h.owner.command('family.link', { agreementId: amendment.id, version: amendmentRow.version, parentId: msa.id, relation: 'amends' })

  // A duplicate created by intake, approved before anyone noticed.
  const dupDeal = await people.requester.command('request.create', { title: 'Acme gripper NDA', type: 'nda', party: { name: 'ACME Robotics', kind: 'supplier' }, file: file('nda.pdf', pdf('NDA')), text: 'Mutual NDA' })
  let a = (await people.requester.state()).agreements.find(x => x.id === dupDeal.id)
  await people.requester.command('agreement.submit', { agreementId: a.id, version: a.version })
  a = (await people.approver.state()).agreements.find(x => x.id === dupDeal.id)
  await people.approver.command('approval.decide', { agreementId: a.id, version: a.version, versionId: a.current_version_id, kind: 'commercial', decision: 'approved' })
  s = await h.owner.state()
  const dup = s.parties.find(p => p.name === 'ACME Robotics'), keep = s.parties.find(p => p.id === kept.id)
  assert.notEqual(dup.id, keep.id)
  assert.deepEqual([keep.entity_type, keep.formation, keep.tax_id_kind, keep.tax_id, keep.notice_address, keep.notice_method], ['Corporation', 'Delaware', 'ein', '98-7654321', acme.noticeAddress, 'courier'])
  assert.deepEqual(JSON.parse(keep.signatories), acme.signatories)
  assert.deepEqual(JSON.parse(keep.contacts), acme.contacts)

  // Only owner or counsel merge; a stale version is refused; the merge moves agreements and withdraws approvals in negotiation.
  const merge = { keepId: keep.id, keepVersion: keep.version, duplicateId: dup.id, duplicateVersion: dup.version, reason: 'Same Delaware corporation, EIN 98-7654321' }
  await people.requester.command('party.merge', merge, { error: 'FORBIDDEN' })
  await people.counsel.command('party.merge', { ...merge, keepVersion: keep.version + 1 }, { error: 'STALE' })
  const merged = await people.counsel.command('party.merge', merge)
  assert.equal(merged.agreements, 1)
  await people.counsel.command('party.merge', { ...merge, keepVersion: keep.version + 1, duplicateVersion: dup.version + 1 }, { error: 'MERGED' })
  await people.requester.command('party.save', { id: dup.id, name: 'ACME Robotics', kind: 'supplier' }, { error: 'MERGED' })
  s = await h.owner.state()
  const moved = s.agreements.find(x => x.id === dupDeal.id)
  assert.deepEqual([moved.party_id, moved.status], [keep.id, 'in_review'])
  assert.ok(s.approvals.filter(x => x.agreement_id === dupDeal.id).every(x => x.invalidated_reason === 'Counterparty merged'))
  const history = s.parties.find(p => p.id === dup.id)
  assert.deepEqual([history.merged_into, history.merged_by, history.merge_reason], [keep.id, people.counsel.id, merge.reason])
  assert.ok(s.audit.some(x => x.action === 'party.merge' && x.agreement_id === dupDeal.id && x.summary.includes('earlier approvals no longer count')))
  // Intake by the duplicate's name or id now lands on the kept record.
  const again = await people.requester.command('request.create', { title: 'Acme follow-on', type: 'nda', party: { name: 'acme robotics', kind: 'supplier' } })
  const byId = await people.requester.command('request.create', { title: 'Acme second follow-on', type: 'nda', partyId: dup.id })
  s = await h.owner.state()
  assert.deepEqual([again.id, byId.id].map(id => s.agreements.find(x => x.id === id).party_id), [keep.id, keep.id])

  // The page's figures: contracted USD from executed/imported values, annual over the confirmed term, family grouping and the next deadline.
  const summary = s.counterparties[keep.id]
  assert.equal(summary.totalCents, 18000000)
  assert.equal(summary.annualCents, 6000000) // 120,000 over 730 days -> 60,000 a year; the pilot's 10,000 has no dates
  assert.deepEqual(summary.undated.sort(), [amendment.id, hidden.id].sort())
  assert.deepEqual(summary.families.find(f => f.rootId === msa.id).ids.sort(), [msa.id, amendment.id].sort())
  assert.ok(summary.families.some(f => f.rootId === draft.id))
  assert.deepEqual([summary.nextDeadline.agreementId, summary.nextDeadline.date], [msa.id, '2027-11-01'])
  // A viewer's figures leave out the restricted agreement they may not see.
  const seen = (await viewer.state()).counterparties[keep.id]
  assert.equal(seen.totalCents, 17000000)
  assert.ok(!seen.undated.includes(hidden.id))
})
