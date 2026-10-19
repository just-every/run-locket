import test from 'node:test'
import assert from 'node:assert/strict'
import { installation } from './harness.mjs'
import { readFile } from 'node:fs/promises'
import { file, pdf } from './files.mjs'

const parent = { legalName: 'Brightline Holdings, Inc.', entityType: 'Corporation', formation: 'Delaware, United States', taxIdKind: 'ein', taxId: '12-3456789', registeredAddress: '251 Little Falls Drive, Wilmington, DE 19808', noticeAddress: 'Legal Department, 100 Pine Street, New York, NY 10005', currency: 'USD', timezone: 'America/New_York', signatories: [{ name: 'Dana Park', email: 'dana@brightline.example', title: 'Chief Executive Officer' }] }
const uk = { legalName: 'Brightline UK Limited', entityType: 'Private limited company', formation: 'England and Wales, United Kingdom', taxIdKind: 'foreign', taxId: 'GB123456789', registeredAddress: '1 Poultry, London EC2R 8EJ', noticeAddress: 'Company Secretary, 20 Farringdon Road, London EC1M 3HE', currency: 'GBP', timezone: 'Europe/London', signatories: [{ name: 'Alex Morgan', email: 'alex@brightline-uk.example', title: 'Managing Director' }, { name: 'Sam Reid', email: 'sam@brightline-uk.example', title: 'Finance Director' }] }
const body = 'Mutual NDA between {{our_entity}} and {{counterparty}}.\nNotices to us: {{our_notice_address}}.\n[[clause:law]]\nSigned for us by {{our_signatory}}.'
const clauses = ids => [{ key: 'law', title: 'Governing law', variants: [{ id: 'uk', label: 'English law', text: 'This agreement is governed by the laws of England and Wales.', entityId: ids.uk }, { id: 'us', label: 'New York law', text: 'This agreement is governed by the laws of New York.', entityId: ids.parent }] }]
const repository = (client, filters) => client.request('/api/locket/repository?definition=' + encodeURIComponent(JSON.stringify({ query: '', filters, sort: { field: 'title', direction: 'asc' }, columns: ['title', 'entity'] }))).then(r => r.json())

test('ENTITY-001 our entities scope templates, wordings, rules and signatories, fill notices and filter the register', async t => {
  const h = await installation(); t.after(() => h.close())
  const counsel = await h.invite('counsel@example.test', 'counsel')
  const viewer = await h.invite('viewer@example.test', 'viewer')
  // Recorded before any entity exists: named later by counsel.
  const earlier = await h.owner.command('request.create', { title: 'Earlier NDA', type: 'nda', party: { name: 'Juniper Labs', kind: 'customer' } })

  // A journey adds a Delaware parent company and a UK subsidiary; only the owner records entities.
  await counsel.command('entity.save', parent, { error: 'FORBIDDEN' })
  await h.owner.command('entity.save', { ...parent, taxId: '123456789' }, { error: 'INVALID' })
  const ids = { parent: (await h.owner.command('entity.save', parent)).id, uk: (await h.owner.command('entity.save', uk)).id }
  await h.owner.command('entity.save', { ...uk, legalName: 'brightline uk limited' }, { error: 'DUPLICATE' })
  let s = await viewer.state()
  assert.deepEqual(s.entities.map(e => [e.legal_name, e.formation, e.currency, e.timezone]), [[parent.legalName, parent.formation, 'USD', 'America/New_York'], [uk.legalName, uk.formation, 'GBP', 'Europe/London']])

  // Templates, clause wordings and playbook rules limited to one entity.
  const ukTemplate = await h.owner.command('template.create', { name: 'UK NDA', type: 'nda', entityId: ids.uk, body, fields: [], clauses: clauses(ids) })
  const usTemplate = await h.owner.command('template.create', { name: 'US NDA', type: 'nda', entityId: ids.parent, body, fields: [], clauses: clauses(ids) })
  for (const v of [ukTemplate, usTemplate]) await h.owner.command('template.decide', { versionId: v.versionId, decision: 'approve' })
  assert.deepEqual((await h.owner.state()).templates.map(x => [x.name, x.entity_id]), [['UK NDA', ids.uk], ['US NDA', ids.parent]])
  const playbook = await h.owner.command('playbook.draft', { rules: [{ key: 'law', title: 'Governing law', preferred: 'New York law.', alternatives: [], authority: 'counsel', entityId: ids.parent }] })
  await h.owner.command('playbook.activate', { id: playbook.id })

  // Every new agreement names its entity; the UK agreement takes only the UK template and wording.
  const request = { title: 'UK mutual NDA', type: 'nda', party: { name: 'Northwind Partners', kind: 'partner' } }
  await h.owner.command('request.create', { ...request, templateVersionId: ukTemplate.versionId }, { error: 'ENTITY_REQUIRED' })
  await h.owner.command('request.create', { ...request, entityId: ids.uk, templateVersionId: usTemplate.versionId }, { error: 'ENTITY_SCOPE' })
  await h.owner.command('request.create', { ...request, entityId: ids.uk, templateVersionId: ukTemplate.versionId, clauseChoices: { law: 'us' } }, { error: 'ENTITY_SCOPE' })
  const ukDeal = await h.owner.command('request.create', { ...request, entityId: ids.uk, templateVersionId: ukTemplate.versionId })
  s = await h.owner.state()
  const ukAgreement = s.agreements.find(a => a.id === ukDeal.id)
  assert.equal(ukAgreement.entity_id, ids.uk)
  assert.equal(ukAgreement.timezone, 'Europe/London')
  assert.equal(s.versions.find(v => v.id === ukDeal.versionId).text, `Mutual NDA between ${uk.legalName} and Northwind Partners.\nNotices to us: ${uk.noticeAddress}.\nThis agreement is governed by the laws of England and Wales.\nSigned for us by Alex Morgan, Managing Director.`)
  await counsel.command('deviation.add', { agreementId: ukDeal.id, versionId: ukDeal.versionId, clauseKey: 'law', result: 'breached', start: 0, end: 10, quote: 'Mutual NDA', explanation: 'Not New York law.' }, { error: 'ENTITY_SCOPE' })
  const libraryVariant = (await h.owner.state()).templateVersions.find(v => v.id === usTemplate.versionId)
  await h.owner.command('clause.insert', { agreementId: ukDeal.id, version: ukAgreement.version, versionId: ukDeal.versionId, libraryVersionId: libraryVariant.id, clauseKey: 'law', variantId: 'us', start: 0, end: 0, quote: '' }, { error: 'ENTITY_SCOPE' })

  // It routes to the UK entity's signatory, never another entity's.
  await h.owner.command('agreement.submit', { agreementId: ukDeal.id, version: ukAgreement.version })
  s = await h.owner.state()
  let a = s.agreements.find(x => x.id === ukDeal.id)
  await h.owner.command('approval.decide', { agreementId: ukDeal.id, version: a.version, versionId: ukDeal.versionId, kind: 'commercial', decision: 'approved' })
  a = (await h.owner.state()).agreements.find(x => x.id === ukDeal.id)
  const counterparty = [{ name: 'Riley Chen', email: 'riley@northwind.example', action: 'sign', signingFor: 'Northwind Partners' }]
  await h.owner.command('package.prepare', { agreementId: ukDeal.id, version: a.version, provider: 'docusign', recipients: counterparty, signatoryEmail: 'dana@brightline.example' }, { error: 'SIGNATORY' })
  await h.owner.command('package.prepare', { agreementId: ukDeal.id, version: a.version, provider: 'docusign', recipients: [...counterparty, { name: 'Dana Park', email: 'dana@brightline.example', action: 'sign', signingFor: uk.legalName }] }, { error: 'SIGNATORY' })
  const pkg = await h.owner.command('package.prepare', { agreementId: ukDeal.id, version: a.version, provider: 'docusign', recipients: counterparty, signatoryEmail: 'sam@brightline-uk.example' })
  const manifest = await (await h.owner.request(`/api/locket/files/${pkg.manifestArtifactId}`)).json()
  assert.deepEqual(manifest.recipients.map(r => [r.email, r.action, r.signingFor]), [['riley@northwind.example', 'sign', 'Northwind Partners'], ['sam@brightline-uk.example', 'sign', uk.legalName]])
  assert.deepEqual(manifest.entity, { id: ids.uk, legalName: uk.legalName, signatory: uk.signatories[1] })

  // Its termination notice carries the UK entity's notice address and signatory.
  const signed = await h.owner.command('legacy.import', { title: 'UK supply agreement', type: 'supplier', entityId: ids.uk, party: { name: 'Cardinal Supply', kind: 'supplier' }, sourceSystem: 'Archive', sourceId: 'uk-1', file: file('uk.pdf', pdf('Ends December 31. Give 60 days notice.')), text: 'Ends December 31. Give 60 days notice.', signed: true })
  for (const [key, value] of [['end_date', '2026-12-31'], ['notice_days', '60']]) {
    const term = await h.owner.command('term.propose', { agreementId: signed.id, key, value, citation: { quote: 'Give 60 days notice.' } })
    await h.owner.command('term.decide', { agreementId: signed.id, termId: term.id, decision: 'confirm' })
  }
  const renewal = (await h.owner.state()).renewals.find(r => r.agreement_id === signed.id)
  await h.owner.command('renewal.decide', { renewalId: renewal.id, decision: 'terminate', reason: 'Replacing the supplier.' })
  const notice = await h.owner.command('notice.prepare', { renewalId: renewal.id, recipient: 'notices@cardinal.example', body: 'We give notice of termination at the end of the current term.' })
  const letter = (await h.owner.state()).noticeLetters.find(l => l.id === notice.id)
  const text = Buffer.from(await (await h.owner.request(`/api/locket/files/${letter.artifact_id}`)).arrayBuffer()).toString('latin1')
  for (const line of [`From: ${uk.legalName}`, uk.noticeAddress, 'Alex Morgan, Managing Director', `For and on behalf of ${uk.legalName}`]) assert.ok(text.includes(line), line)
  assert.ok(!text.includes(parent.noticeAddress))

  // A DocuSign archive move-in names one entity for the batch, and its agreements take it.
  const movein = { kit: 'docusign-archive', label: 'UK DocuSign archive', dateFormat: 'dmy', manifest: file('envelopes.csv', await readFile('tests/fixtures/docusign-archive/envelopes.csv')), files: [['3F2A9C10-5B7E-4D21-9A6B-1C2D3E4F5A60/Harbour Supplies MSA.pdf', pdf('Harbour Supplies MSA, signed')], ['3F2A9C10-5B7E-4D21-9A6B-1C2D3E4F5A60/Summary.pdf', pdf('Certificate of Completion')]].map(([path, bytes]) => ({ path, base64: bytes.toString('base64') })) }
  await h.owner.command('import.preview', movein, { error: 'ENTITY_REQUIRED' })
  const batch = await h.owner.command('import.preview', { ...movein, entityId: ids.uk })
  const previewed = (await h.owner.state()).imports.find(b => b.id === batch.batchId)
  await h.owner.command('import.apply', { batchId: batch.batchId, version: previewed.version, fingerprint: batch.fingerprint })
  const moved = (await h.owner.state()).agreements.filter(a => a.origin === 'docusign-archive')
  assert.ok(moved.length > 0)
  assert.deepEqual([...new Set(moved.map(a => [a.entity_id, a.timezone].join()))], [[ids.uk, 'Europe/London'].join()])

  // The register filters and the portfolio groups agreements by entity; the earlier one is named once assigned.
  assert.deepEqual((await repository(viewer, [{ field: 'entity', operator: 'eq', value: uk.legalName }])).rows.map(r => r.values.title).filter(x => x.startsWith('UK')), ['UK mutual NDA', 'UK supply agreement'])
  assert.equal((await repository(viewer, [{ field: 'entity', operator: 'eq', value: uk.legalName }])).rows.length, 2 + moved.length)
  await viewer.command('agreement.entity', { agreementId: earlier.id, version: 1, entityId: ids.parent }, { error: 'FORBIDDEN' })
  await counsel.command('agreement.entity', { agreementId: earlier.id, version: 1, entityId: ids.parent })
  assert.deepEqual((await repository(viewer, [{ field: 'entity', operator: 'eq', value: parent.legalName }])).rows.map(r => r.values), [{ title: 'Earlier NDA', entity: parent.legalName }])
  const tiles = (await (await viewer.request('/api/locket/portfolio')).json()).tiles
  assert.deepEqual(tiles.filter(x => x.id.startsWith('entity-')).map(x => [x.label, [...x.agreementIds].sort()]), [[`Entity: ${parent.legalName}`, []], [`Entity: ${uk.legalName}`, [...moved.map(a => a.id), signed.id].sort()], ['Entity: not recorded', []]].map(([label, ids]) => [label, ids]))
  const ukOnly = (await (await viewer.request(`/api/locket/portfolio?entityId=${ids.uk}`)).json()).tiles.find(x => x.id === 'all')
  assert.deepEqual([...ukOnly.agreementIds].sort(), [...moved.map(a => a.id), signed.id].sort())
  assert.ok((await h.owner.state()).audit.some(e => e.action === 'agreement.entity' && e.agreement_id === earlier.id))
})
