import { executionFollowupJourney, executionFollowupRefusals, acrobatRetrievalJourney, dropboxRetrievalJourney } from './execution-followup-journey.mjs'
// One flow per first-release clause (CONTRACT.md), through the authenticated
// HTTP API of the real Worker with D1.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { installation } from './harness.mjs'
import { agreement, approved, docx, executed, file, find, library, outForSignature, pdf, submitted, team } from './setup.mjs'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const download = async (client, id) => Buffer.from(await (await client.request(`/api/locket/files/${id}`)).arrayBuffer())

test('01 legacy PDF and DOCX keep original bytes, source identity and provenance', async t => {
  const h = await installation(); t.after(() => h.close())
  const bytes = pdf('Legacy master services agreement 2019', 2)
  const imported = await h.owner.command('legacy.import', { title: 'Legacy MSA', type: 'customer', party: { name: 'Old Customer', kind: 'customer' }, sourceSystem: 'Shared drive', sourceId: 'Contracts/2019/msa-old-customer.pdf', signed: true, file: file('msa.pdf', bytes) })
  const s = await h.owner.state()
  const a = s.agreements.find(x => x.id === imported.id)
  assert.equal(a.status, 'imported')
  const original = s.artifacts.find(f => f.agreement_id === a.id && f.role === 'original')
  assert.equal(original.sha256, sha(bytes))
  assert.equal(original.source_system, 'Shared drive')
  assert.equal(original.source_id, 'Contracts/2019/msa-old-customer.pdf')
  assert.equal(JSON.parse(original.provenance).originalFilename, 'msa.pdf')
  assert.ok(original.imported)
  const fetched = await h.owner.request(`/api/locket/files/${original.id}`)
  assert.equal(fetched.headers.get('x-locket-sha256'), sha(bytes))
  assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), bytes)
  await h.owner.command('legacy.import', { title: 'Copy', type: 'customer', party: { name: 'Old Customer', kind: 'customer' }, sourceSystem: 'Email', sourceId: 'x', file: file('copy.pdf', bytes) }, { error: 'DUPLICATE_FILE' })
  await h.owner.command('legacy.import', { title: 'Other', type: 'customer', party: { name: 'Old Customer', kind: 'customer' }, sourceSystem: 'Shared drive', sourceId: 'Contracts/2019/msa-old-customer.pdf', file: file('other.pdf', pdf('different bytes')) }, { error: 'DUPLICATE_SOURCE' })
  const word = docx(['NON-DISCLOSURE AGREEMENT', 'Each party keeps the other party’s information confidential for 3 years.'])
  const nda = await h.owner.command('legacy.import', { title: 'Old NDA', type: 'nda', party: { name: 'Old Customer', kind: 'customer' }, sourceSystem: 'Shared drive', sourceId: 'nda.docx', file: file('nda.docx', word) })
  const v = (await h.owner.state()).versions.find(x => x.agreement_id === nda.id)
  assert.equal(v.text_source, 'docx')
  assert.match(v.text, /confidential for 3 years/)
  assert.deepEqual(await download(h.owner, (await h.owner.state()).artifacts.find(f => f.version_id === v.id).id), word)
})

test('02 intake captures the deal and blocks review until required attachments are present', async t => {
  const h = await installation(); t.after(() => h.close())
  const tm = await team(h)
  const created = await tm.requester.command('request.create', { title: 'Courier services', type: 'supplier', party: { name: 'Fast Couriers', kind: 'supplier', taxIdKind: 'ein', taxId: '12-3456789' }, value: '48000.50', ownerId: tm.approver.id, neededBy: '2026-11-30', startDate: '2026-12-01', file: file('draft.pdf', pdf('Courier draft')), text: 'Courier services agreement draft' })
  const s = await tm.requester.state()
  const a = s.agreements.find(x => x.id === created.id)
  assert.equal(a.value_cents, 4800050)
  assert.equal(a.owner_id, tm.approver.id)
  assert.equal(a.requester_id, tm.requester.id)
  assert.equal(a.needed_by, '2026-11-30')
  assert.equal(s.parties.find(p => p.id === a.party_id).name, 'Fast Couriers')
  const required = s.requirements.filter(r => r.agreement_id === a.id)
  assert.deepEqual(required.map(r => r.label).sort(), ['Certificate of insurance', 'Form W-9'])
  const blocked = await tm.requester.command('agreement.submit', { agreementId: a.id, version: a.version }, { error: 'MISSING_ATTACHMENTS' })
  assert.deepEqual(blocked.error.details.missing.sort(), ['Certificate of insurance', 'Form W-9'])
  for (const r of required) await tm.requester.command('requirement.attach', { agreementId: a.id, requirementId: r.id, file: file(`${r.label}.pdf`, pdf(r.label)) })
  const after = await find(tm.requester, a.id)
  assert.equal((await tm.requester.command('agreement.submit', { agreementId: a.id, version: after.version })).status, 'in_review')
  await tm.requester.command('request.create', { title: 'Variation', type: 'amendment', party: { name: 'Fast Couriers', kind: 'supplier' } }, { error: 'PARENT_REQUIRED' })
  await tm.requester.command('request.create', { title: 'Bad value', type: 'customer', party: { name: 'X', kind: 'customer' }, value: '12.345' }, { error: 'INVALID' })
})

test('03 only an approved template version populates a request, with its fields and chosen clauses', async t => {
  const h = await installation(); t.after(() => h.close())
  const tm = await team(h)
  await tm.requester.command('template.create', { name: 'Rogue', type: 'nda', body: 'x', fields: [], clauses: [] }, { error: 'FORBIDDEN' })
  const draft = await tm.counsel.command('template.create', { name: 'Mutual NDA', type: 'nda', body: 'NDA with {{counterparty}} for {{purpose}}.\n[[clause:term]]', fields: [{ name: 'purpose', label: 'Purpose', required: true }], clauses: [{ key: 'term', title: 'Term', variants: [{ id: 'two', label: '2 years', text: 'Obligations last 2 years.' }, { id: 'five', label: '5 years', text: 'Obligations last 5 years.' }] }] })
  const request = { title: 'Ridgeway NDA', type: 'nda', party: { name: 'Ridgeway', kind: 'partner' }, templateVersionId: draft.versionId, fields: { purpose: 'a joint bid' }, clauseChoices: { term: 'five' } }
  await tm.requester.command('request.create', request, { error: 'TEMPLATE_NOT_APPROVED' })
  await tm.counsel.command('template.decide', { versionId: draft.versionId, decision: 'approve' })
  await tm.requester.command('request.create', { ...request, fields: {} }, { error: 'FIELDS' })
  const created = await tm.requester.command('request.create', request)
  let s = await tm.requester.state()
  const v = s.versions.find(x => x.id === created.versionId)
  assert.equal(v.text, 'NDA with Ridgeway for a joint bid.\nObligations last 5 years.')
  assert.equal(v.template_version_id, draft.versionId)
  assert.deepEqual(JSON.parse(v.fields).clauses, { term: 'five' })
  // A later template version never rewrites a version already produced.
  const v2 = await tm.counsel.command('template.revise', { templateId: draft.id, body: 'Changed {{counterparty}} {{purpose}}', fields: [{ name: 'purpose', label: 'Purpose', required: true }], clauses: [] })
  await tm.counsel.command('template.decide', { versionId: v2.versionId, decision: 'approve' })
  s = await tm.requester.state()
  assert.equal(s.versions.find(x => x.id === created.versionId).text, v.text)
})

test('04 the clause playbook is versioned and reviews cite the version they used', async t => {
  const h = await installation(); t.after(() => h.close())
  const tm = await team(h)
  await tm.requester.command('playbook.draft', { rules: [{ key: 'x', title: 'X', preferred: 'p', alternatives: [], authority: 'counsel' }] }, { error: 'FORBIDDEN' })
  const lib = await library(h, tm)
  const v2 = await tm.owner.command('playbook.draft', { rules: [{ key: 'liability', title: 'Limitation of liability', preferred: 'Capped at 12 months of fees.', alternatives: ['Capped at 24 months of fees.'], authority: 'counsel' }] })
  const id = await agreement(h, tm, lib)
  const v = (await tm.counsel.state()).versions.find(x => x.agreement_id === id)
  const quote = 'Liability is capped at the fees paid in the prior 12 months.'
  const first = await tm.counsel.command('deviation.add', { agreementId: id, versionId: v.id, clauseKey: 'liability', result: 'met', start: v.text.indexOf(quote), end: v.text.indexOf(quote) + quote.length, quote, explanation: 'Matches preferred wording.' })
  await tm.owner.command('playbook.activate', { id: v2.id })
  const s = await tm.counsel.state()
  assert.equal(s.playbooks.find(p => p.id === lib.playbookId).status, 'superseded')
  assert.equal(s.playbooks.find(p => p.id === v2.id).status, 'active')
  assert.equal(s.deviations.find(d => d.id === first.id).playbook_version_id, lib.playbookId)
  assert.deepEqual(JSON.parse(s.playbooks.find(p => p.id === v2.id).rules)[0].alternatives, ['Capped at 24 months of fees.'])
  await tm.counsel.command('deviation.add', { agreementId: id, versionId: v.id, clauseKey: 'payment', result: 'met', start: 0, end: 6, quote: 'SUPPLY', explanation: 'x' }, { error: 'INVALID' })
})

test('05 successive negotiation versions compare line by line and keep untouched originals and comments', async t => {
  const h = await installation(); t.after(() => h.close())
  const tm = await team(h)
  const ours = docx(['SERVICES AGREEMENT', 'Fees are payable within 30 days.', 'Either party may terminate on 90 days notice.'])
  const theirs = docx(['SERVICES AGREEMENT', 'Fees are payable within 45 days.', 'Either party may terminate on 90 days notice.', 'Supplier may subcontract.'])
  const created = await tm.requester.command('request.create', { title: 'Cleaning services', type: 'customer', party: { name: 'Clean Co', kind: 'customer' }, file: file('ours.docx', ours) })
  let a = await find(tm.requester, created.id)
  const markup = await tm.requester.command('version.upload', { agreementId: a.id, version: a.version, kind: 'counterparty', label: 'Clean Co markup', file: file('theirs.docx', theirs) })
  a = await find(tm.requester, created.id)
  assert.equal(a.current_version_id, markup.versionId)
  const diff = await (await tm.requester.request(`/api/locket/compare?from=${created.versionId}&to=${markup.versionId}`)).json()
  assert.deepEqual(diff.lines.filter(l => l.op !== 'same'), [{ op: 'del', text: 'Fees are payable within 30 days.' }, { op: 'add', text: 'Fees are payable within 45 days.' }, { op: 'add', text: 'Supplier may subcontract.' }])
  const s = await tm.requester.state()
  assert.deepEqual(await download(tm.requester, s.artifacts.find(f => f.version_id === created.versionId).id), ours)
  assert.deepEqual(await download(tm.requester, s.artifacts.find(f => f.version_id === markup.versionId).id), theirs)
  await tm.counsel.command('comment.add', { agreementId: a.id, versionId: markup.versionId, body: 'Push back to 30 days.', quote: 'Fees are payable within 45 days.' })
  const comment = (await tm.requester.state()).comments.find(c => c.version_id === markup.versionId)
  assert.equal(comment.quote, 'Fees are payable within 45 days.')
  await tm.requester.command('version.upload', { agreementId: a.id, version: a.version - 1, kind: 'upload', file: file('stale.docx', ours) }, { error: 'STALE' })
})

test('06 review findings cite exact passages, separate met, breached and cannot-determine, and agents only propose', async t => {
  const h = await installation(); t.after(() => h.close())
  const tm = await team(h)
  const agent = await h.invite('agent@example.test', 'agent')
  const lib = await library(h, tm)
  const id = await agreement(h, tm, lib, { clause: 'net45' })
  const v = (await tm.counsel.state()).versions.find(x => x.agreement_id === id)
  const quote = 'Payment terms: invoices are payable within 45 days.'
  const start = v.text.indexOf(quote)
  await tm.counsel.command('deviation.add', { agreementId: id, versionId: v.id, clauseKey: 'payment', result: 'breached', start, end: start + quote.length, quote: 'Payment terms: invoices are payable within 30 days.', explanation: 'x' }, { error: 'CITATION' })
  await agent.command('deviation.add', { agreementId: id, versionId: v.id, clauseKey: 'payment', result: 'breached', start, end: start + quote.length, quote, explanation: 'x' }, { error: 'FORBIDDEN' })
  const liability = 'Liability is capped at the fees paid in the prior 12 months.'
  const ls = v.text.indexOf(liability)
  const proposal = await agent.command('proposal.prepare', { kind: 'review', payload: { agreementId: id, versionId: v.id, findings: [
    { clauseKey: 'payment', result: 'breached', start, end: start + quote.length, quote, proposedWording: 'Payment terms: invoices are payable within 30 days.', explanation: '45 days is outside the preferred 30 days but is an allowed alternative needing approver sign-off.', questions: [] },
    { clauseKey: 'liability', result: 'undetermined', start: ls, end: ls + liability.length, quote: liability, explanation: 'The fee base for the cap is not defined in a schedule.', questions: ['Which fees count towards the cap?'] },
  ] }, evidence: ['Template text v1 clause payment', 'Playbook v1 rules payment and liability'] })
  await agent.command('proposal.decide', { proposalId: proposal.id, decision: 'approve' }, { error: 'FORBIDDEN' })
  await tm.counsel.command('proposal.decide', { proposalId: proposal.id, decision: 'approve' })
  const s = await tm.counsel.state()
  const findings = s.deviations.filter(d => d.agreement_id === id)
  assert.deepEqual(findings.map(d => d.result).sort(), ['breached', 'undetermined'])
  assert.ok(findings.every(d => d.proposal_id === proposal.id && d.created_by === tm.counsel.id))
  assert.equal(findings.find(d => d.result === 'undetermined').quote, liability)
  assert.deepEqual(JSON.parse(findings.find(d => d.result === 'undetermined').questions), ['Which fees count towards the cap?'])
  assert.equal(s.proposals.find(p => p.id === proposal.id).status, 'approved')
})

test('07 approvals route exceptions to the right authority and pin the exact version and context', async t => {
  const h = await installation(); t.after(() => h.close())
  const tm = await team(h)
  const lib = await library(h, tm)
  const id = await submitted(h, tm, lib)
  let a = await find(tm.counsel, id)
  const v = (await tm.counsel.state()).versions.find(x => x.id === a.current_version_id)
  const quote = 'Liability is capped at the fees paid in the prior 12 months.', start = v.text.indexOf(quote)
  const finding = await tm.counsel.command('deviation.add', { agreementId: id, versionId: v.id, clauseKey: 'liability', result: 'breached', start, end: start + quote.length, quote, explanation: 'Counterparty asked to remove the cap in discussion.' })
  const route = (await tm.counsel.state()).routes[id]
  assert.deepEqual(route.map(r => r.kind), ['commercial', 'exception'])
  a = await find(tm.approver, id)
  await tm.approver.command('approval.decide', { agreementId: id, version: a.version, versionId: v.id, kind: 'exception', deviationId: finding.id, decision: 'approved' }, { error: 'FORBIDDEN' })
  await tm.requester.command('approval.decide', { agreementId: id, version: a.version, versionId: v.id, kind: 'commercial', decision: 'approved' }, { error: 'FORBIDDEN' })
  const commercial = await tm.approver.command('approval.decide', { agreementId: id, version: a.version, versionId: v.id, kind: 'commercial', decision: 'approved' })
  assert.equal(commercial.status, 'in_review')
  a = await find(tm.counsel, id)
  assert.equal((await tm.counsel.command('approval.decide', { agreementId: id, version: a.version, versionId: v.id, kind: 'exception', deviationId: finding.id, decision: 'approved', reason: 'Cap retained in v1' })).status, 'approved')
  let s = await tm.owner.state()
  assert.ok(s.approvals.filter(x => x.agreement_id === id).every(x => x.version_id === v.id && x.version_digest === v.digest))
  // A new version after approval withdraws every approval and reopens review.
  a = await find(tm.requester, id)
  const v2 = await tm.requester.command('version.upload', { agreementId: id, version: a.version, kind: 'counterparty', file: file('markup.pdf', pdf('Counterparty markup')), text: 'Changed terms' })
  s = await tm.owner.state()
  a = s.agreements.find(x => x.id === id)
  assert.equal(a.status, 'in_review')
  assert.ok(s.approvals.filter(x => x.agreement_id === id).every(x => x.invalidated_at && /Version 2/.test(x.invalidated_reason)))
  await tm.approver.command('approval.decide', { agreementId: id, version: a.version, versionId: v.id, kind: 'commercial', decision: 'approved' }, { error: 'NOT_CURRENT' })
  assert.equal((await tm.approver.command('approval.decide', { agreementId: id, version: a.version, versionId: v2.versionId, kind: 'commercial', decision: 'approved' })).status, 'approved')
  // Changing the value is a context change: the approval stops counting.
  a = await find(tm.requester, id)
  await tm.requester.command('request.update', { agreementId: id, version: a.version, value: '99000' })
  assert.equal((await find(tm.owner, id)).status, 'in_review')
})

test('08 an approved version becomes a signature-ready PDF and routing manifest for the existing provider', async t => {
  const h = await installation(); t.after(() => h.close())
  const tm = await team(h)
  const lib = await library(h, tm)
  const draft = await agreement(h, tm, lib)
  const d = await find(tm.requester, draft)
  await tm.requester.command('package.prepare', { agreementId: draft, version: d.version, provider: 'docusign', recipients: [{ name: 'A', email: 'a@example.test', action: 'sign' }] }, { error: 'STATUS' })
  const id = await approved(h, tm, lib)
  // A finding that the rule is met changes nothing the approval rests on.
  const v1 = (await tm.counsel.state()).versions.find(x => x.agreement_id === id)
  const met = 'Payment terms: invoices are payable within 30 days.', ms = v1.text.indexOf(met)
  await tm.counsel.command('deviation.add', { agreementId: id, versionId: v1.id, clauseKey: 'payment', result: 'met', start: ms, end: ms + met.length, quote: met, explanation: 'Preferred position.' })
  let a = await find(tm.requester, id)
  assert.equal(a.status, 'approved')
  await tm.requester.command('package.prepare', { agreementId: id, version: a.version, provider: 'docusign', recipients: [{ name: 'Copy', email: 'c@example.test', action: 'copy' }] }, { error: 'INVALID' })
  const pkg = await tm.requester.command('package.prepare', { agreementId: id, version: a.version, provider: 'docusign', recipients: [{ name: 'Hana Park', email: 'Hana@Harbour.example', action: 'sign' }, { name: 'Finance', email: 'finance@example.test', action: 'copy' }] })
  const pdfBytes = await download(tm.requester, pkg.pdfArtifactId)
  assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-')
  assert.equal(sha(pdfBytes), pkg.documentSha256)
  assert.match(pdfBytes.toString('latin1'), /invoices are payable within 30 days/)
  const manifest = JSON.parse((await download(tm.requester, pkg.manifestArtifactId)).toString())
  const v = (await tm.requester.state()).versions.find(x => x.id === a.current_version_id)
  assert.equal(manifest.version.digest, v.digest)
  assert.equal(manifest.document.sha256, pkg.documentSha256)
  assert.deepEqual(manifest.recipients.map(r => [r.order, r.email, r.action]), [[1, 'hana@harbour.example', 'sign'], [2, 'finance@example.test', 'copy']])
  a = await find(tm.requester, id)
  await tm.requester.command('package.sent', { agreementId: id, version: a.version, packageId: pkg.packageId, envelopeId: 'ENV-1' })
  assert.equal((await find(tm.requester, id)).status, 'out_for_signature')
  // A DOCX version needs the PDF it will be signed as, attached before approval.
  const word = await tm.requester.command('request.create', { title: 'Word deal', type: 'nda', party: { name: 'Word Co', kind: 'customer' }, file: file('deal.docx', docx(['Deal text'])) })
  let w = await find(tm.requester, word.id)
  await tm.requester.command('agreement.submit', { agreementId: word.id, version: w.version })
  w = await find(tm.approver, word.id)
  await tm.approver.command('approval.decide', { agreementId: word.id, version: w.version, versionId: w.current_version_id, kind: 'commercial', decision: 'approved' })
  w = await find(tm.requester, word.id)
  await tm.requester.command('package.prepare', { agreementId: word.id, version: w.version, provider: 'adobe-acrobat-sign', recipients: [{ name: 'W', email: 'w@example.test', action: 'sign' }] }, { error: 'NEEDS_PDF' })
})

test('09 execution ingests the signed file and certificate and reconciles envelope, signers and document', async t => {
  const h = await installation(); t.after(() => h.close())
  const tm = await team(h)
  const lib = await library(h, tm)
  const { id } = await executed(h, tm, lib)
  let s = await tm.owner.state()
  const e = s.executions.find(x => x.agreement_id === id)
  assert.equal(s.agreements.find(x => x.id === id).status, 'executed')
  assert.deepEqual(JSON.parse(e.checks).map(c => [c.check, c.ok]), [['envelope', true], ['signers', true], ['document', true], ['text', true], ['signature_fields', true], ['certificate', true]])
  assert.deepEqual(JSON.parse(e.checks).find(c => c.check === 'signature_fields').inspection, { status: 'not_detected', fields: [] })
  assert.equal(s.artifacts.find(f => f.id === e.certificate_artifact_id).role, 'certificate')
  // A mismatched return stays unsigned until owner or counsel accepts it with a reason.
  const other = await outForSignature(h, tm, lib, { title: 'Second', party: 'Second Co' })
  let a = await find(tm.requester, other.id)
  const signed = pdf('Second signed copy')
  const mismatch = await tm.requester.command('execution.record', { agreementId: other.id, version: a.version, envelopeId: 'ENV-WRONG', executedOn: '2026-07-02', documentConfirmed: true, signers: [{ name: 'Hana Park', email: 'hana@harbour.example' }], signed: file('s.pdf', signed) })
  assert.equal(mismatch.status, 'needs_review')
  assert.deepEqual(mismatch.checks.filter(c => !c.ok).map(c => c.check), ['envelope', 'signers', 'text', 'certificate'])
  assert.equal((await find(tm.owner, other.id)).status, 'out_for_signature')
  a = await find(tm.requester, other.id)
  await tm.requester.command('execution.resolve', { agreementId: other.id, version: a.version, executionId: mismatch.executionId, reason: 'x' }, { error: 'FORBIDDEN' })
  await tm.counsel.command('execution.resolve', { agreementId: other.id, version: a.version, executionId: mismatch.executionId, reason: 'Counterparty used its own envelope; confirmed by phone.' })
  assert.equal((await find(tm.owner, other.id)).status, 'executed')
  // The same signed file cannot be recorded as a second execution.
  const third = await outForSignature(h, tm, lib, { title: 'Third', party: 'Third Co' })
  a = await find(tm.requester, third.id)
  await tm.requester.command('execution.record', { agreementId: third.id, version: a.version, envelopeId: `ENV-${third.id.slice(0, 8)}`, executedOn: '2026-07-03', documentConfirmed: true, signers: [], signed: file('dup.pdf', signed) }, { error: 'DUPLICATE_EXECUTION' })
  s = await tm.owner.state()
  assert.equal(s.agreements.find(x => x.id === third.id).status, 'out_for_signature')
  assert.equal(s.executions.filter(x => x.agreement_id === third.id).length, 0)
  await automaticRetrievalJourney(t)
  await retrievalAuthorityJourney(t)
  await executionFollowupJourney(t)
  await executionFollowupRefusals(t)
  await acrobatRetrievalJourney(t)
  await dropboxRetrievalJourney(t)
})

test('10 terms and obligations are confirmed against the executed text, and corrections keep history', async t => {
  const h = await installation(); t.after(() => h.close())
  const tm = await team(h)
  const agent = await h.invite('agent@example.test', 'agent')
  const lib = await library(h, tm)
  const draft = await agreement(h, tm, lib, { title: 'Unsigned' })
  await tm.counsel.command('term.propose', { agreementId: draft, key: 'end_date', value: '2027-06-30', citation: { quote: 'Packaging' } }, { error: 'NOT_EXECUTED' })
  const { id } = await executed(h, tm, lib)
  await tm.counsel.command('term.propose', { agreementId: id, key: 'end_date', value: '2027-06-30', citation: { quote: 'This text is not in the agreement' } }, { error: 'CITATION' })
  const proposal = await agent.command('proposal.prepare', { kind: 'terms', payload: { agreementId: id, terms: [
    { key: 'end_date', value: '2027-06-30', citation: { quote: 'SUPPLY AGREEMENT' } },
    { key: 'notice_days', value: '60', citation: { quote: 'Payment terms: invoices are payable within 30 days.' } },
    { key: 'governing_law', value: 'New South Wales', citation: { quote: 'Governing law: New South Wales.' } },
  ] }, evidence: ['Executed text v1'], assumptions: 'No separate term clause; end date taken from the order schedule.' })
  await tm.requester.command('proposal.decide', { proposalId: proposal.id, decision: 'approve' }, { error: 'FORBIDDEN' })
  await tm.approver.command('proposal.decide', { proposalId: proposal.id, decision: 'approve' })
  let s = await tm.owner.state()
  const confirmed = s.terms.filter(x => x.agreement_id === id && x.status === 'confirmed')
  assert.deepEqual(confirmed.map(x => x.key).sort(), ['end_date', 'governing_law', 'notice_days'])
  assert.ok(confirmed.every(x => x.confirmed_by === tm.approver.id && x.proposal_id === proposal.id))
  assert.equal(s.renewals.find(r => r.agreement_id === id).deadline_date, '2027-05-01')
  // Correcting the end date supersedes the earlier value and moves the deadline.
  const fix = await tm.counsel.command('term.propose', { agreementId: id, key: 'end_date', value: '2027-07-31', reason: 'Schedule 2 extends the term', citation: { quote: 'Goods: Packaging.' } })
  await tm.counsel.command('term.decide', { agreementId: id, termId: fix.id, decision: 'confirm' })
  s = await tm.owner.state()
  const history = s.terms.filter(x => x.agreement_id === id && x.key === 'end_date')
  assert.deepEqual(history.map(x => [x.value, x.status]).sort(), [['2027-06-30', 'superseded'], ['2027-07-31', 'confirmed']])
  assert.equal(history.find(x => x.status === 'confirmed').supersedes_id, history.find(x => x.status === 'superseded').id)
  assert.equal(s.renewals.find(r => r.agreement_id === id).deadline_date, '2027-06-01')
  const ob = await tm.requester.command('obligation.add', { agreementId: id, description: 'Send annual insurance certificate', ownerId: tm.requester.id, dueDate: '2027-01-31', recurrence: 'annually', citation: { quote: 'Goods: Packaging.' } })
  await tm.requester.command('obligation.update', { agreementId: id, obligationId: ob.id, action: 'confirm' }, { error: 'FORBIDDEN' })
  await tm.approver.command('obligation.update', { agreementId: id, obligationId: ob.id, action: 'confirm' })
  await tm.requester.command('obligation.update', { agreementId: id, obligationId: ob.id, action: 'done' })
  assert.equal((await tm.owner.state()).obligations.find(x => x.id === ob.id).status, 'done')
  const other = await h.invite('synthetic-locket-second-owner@example.test', 'requester')
  const ownerId = (await tm.owner.state()).actor.id
  const clients = [tm.owner, tm.counsel, tm.approver, tm.requester, other]
  const owners = [ownerId, tm.counsel.id, tm.approver.id, tm.requester.id, other.id]
  const six = []
  for (let i = 0; i < 6; i++) {
    const proposed = await tm.counsel.command('obligation.add', { agreementId: id, description: `synthetic-locket-manual-${i + 1}`, ownerId: owners[i % 5], dueDate: '2027-01-31', recurrence: ['monthly', 'quarterly', 'annually', 'none', 'none', 'none'][i], citation: { quote: 'Goods: Packaging.' } })
    six.push(proposed.id)
  }
  s = await tm.owner.state()
  assert.deepEqual(s.obligations.filter(x => six.includes(x.id)).map(x => x.status), Array(6).fill('proposed'))
  assert.equal(s.ownerObligations.filter(x => six.includes(x.id)).length, 0)
  for (let i = 0; i < 6; i++) await tm.approver.command('obligation.update', { agreementId: id, obligationId: six[i], action: i === 5 ? 'reject' : 'confirm' })
  for (let i = 0; i < 5; i++) {
    const own = (await clients[i].state()).ownerObligations.filter(x => six.includes(x.id))
    assert.deepEqual(own.map(x => [x.id, x.owner_id, x.next_due_date, x.recurrence]), [[six[i], owners[i], '2027-01-31', ['monthly','quarterly','annually','none','none'][i]]])
  }
  s = await tm.owner.state()
  assert.equal(s.obligations.find(x => x.id === six[5]).lifecycle_status, 'rejected')
  assert.deepEqual(s.obligations.filter(x => six.slice(0, 5).includes(x.id)).map(x => x.confirmed_by), Array(5).fill(tm.approver.id))

})

test('AGENT-003 / RENEW-001 the renewal queue computes notice deadlines in the agreement time zone and keeps sending evidence separate', async t => {
  const h = await installation(); t.after(() => h.close())
  const tm = await team(h)
  const agent = await h.invite('agent@example.test', 'agent')
  const lib = await library(h, tm)
  const confirm = async (id, terms) => {
    for (const [key, value, quote] of terms) {
      const term = await tm.counsel.command('term.propose', { agreementId: id, key, value, citation: { quote } })
      await tm.counsel.command('term.decide', { agreementId: id, termId: term.id, decision: 'confirm' })
    }
  }
  // New York daylight saving ends on 1 November 2026 (the default agreement time zone): the deadline offset changes across it.
  const after = (await executed(h, tm, lib, { title: 'After DST', party: 'A Co' })).id
  const before = (await executed(h, tm, lib, { title: 'Before DST', party: 'B Co' })).id
  await confirm(after, [['end_date', '2026-12-01', 'SUPPLY AGREEMENT'], ['notice_days', '30', 'Goods: Packaging.']])
  await confirm(before, [['end_date', '2026-11-30', 'SUPPLY AGREEMENT'], ['notice_days', '30', 'Goods: Packaging.']])
  let s = await tm.owner.state()
  const r1 = s.renewals.find(r => r.agreement_id === after), r2 = s.renewals.find(r => r.agreement_id === before)
  assert.equal(r1.deadline_date, '2026-11-01')
  assert.equal(new Date(r1.deadline_at).toISOString(), '2026-11-02T04:59:59.000Z')
  assert.equal(r2.deadline_date, '2026-10-31')
  assert.equal(new Date(r2.deadline_at).toISOString(), '2026-11-01T03:59:59.000Z')
  assert.deepEqual(s.renewals.map(r => r.agreement_id), [before, after])
  await tm.requester.command('notice.prepare', { renewalId: r1.id, recipient: 'legal@a.example', body: 'x' }, { error: 'NO_DECISION' })
  await tm.requester.command('renewal.decide', { renewalId: r1.id, decision: 'terminate' }, { error: 'FORBIDDEN' })
  await tm.approver.command('renewal.decide', { renewalId: r1.id, decision: 'terminate', reason: 'Moving supplier' })
  const party=s.parties.find(p=>p.id===s.agreements.find(a=>a.id===after).party_id)
  await tm.owner.command('party.save',{id:party.id,version:party.version,name:party.name,kind:'supplier',email:'legal@a.example',noticeAddress:'A Co Legal, 10 Main St, NY',contacts:[],signatories:[]})
  const source=await tm.owner.command('notice.source',{agreementId:after,quote:'Goods: Packaging.'})
  const prepared = await agent.command('proposal.prepare', { kind: 'renewal', payload: { sourceId:source.id }, evidence: ['Person-selected executed passage and confirmed decision/deadline'] })
  const accepted = await tm.approver.command('proposal.decide', { proposalId: prepared.id, decision: 'approve' })
  await tm.owner.command('notice.approve',{noticeId:accepted.outcome.noticeId},{error:'APPROVAL'})
  const manual=await tm.approver.command('notice.prepare',{renewalId:r1.id,recipient:'legal@a.example',body:'We give notice of termination at the end of the current term.'})
  const noticeId = manual.id
  await tm.requester.command('notice.sent', { noticeId, method: 'email', sentAt: '2026-09-20T01:00:00Z' }, { error: 'STATUS' })
  await tm.approver.command('notice.approve', { noticeId }, { error: 'SELF_APPROVAL' })
  await tm.owner.command('notice.approve', { noticeId })
  s = await tm.owner.state()
  const approvedNotice = s.notices.find(n => n.id === noticeId)
  assert.equal(approvedNotice.status, 'approved')
  assert.equal(approvedNotice.sent_at, null)
  await tm.requester.command('notice.sent', { noticeId, method: 'email', sentAt: '2026-09-20T01:00:00Z', evidence: file('sent-email.pdf', pdf('Sent notice email')) })
  s = await tm.owner.state()
  const sent = s.notices.find(n => n.id === noticeId)
  assert.equal(sent.status, 'sent')
  assert.equal(new Date(sent.sent_at).toISOString(), '2026-09-20T01:00:00.000Z')
  assert.equal(s.artifacts.find(f => f.id === sent.evidence_artifact_id).role, 'notice_evidence')
  // A notice drafted through a proposal is still never approved for sending by the person who drafted it.
  const approver2 = await h.invite('approver2@example.test', 'approver')
  await tm.approver.command('renewal.decide', { renewalId: r2.id, decision: 'renew' })
  const drafted = await tm.approver.command('proposal.prepare', { kind: 'renewal', payload: { renewalId: r2.id, recipient: 'legal@b.example', body: 'We will renew.' }, evidence: ['Renewal decided'] })
  const accepted2 = await approver2.command('proposal.decide', { proposalId: drafted.id, decision: 'approve' })
  await tm.approver.command('notice.approve', { noticeId: accepted2.outcome.noticeId }, { error: 'SELF_APPROVAL' })
})

test('12 search returns only agreements the person may access, and the owner exports every record and file', async t => {
  const h = await installation(); t.after(() => h.close())
  const tm = await team(h)
  const viewer = await h.invite('viewer@example.test', 'viewer')
  const secret = await tm.counsel.command('request.create', { title: 'Settlement deed', type: 'other', party: { name: 'Quiet Party', kind: 'other' }, restricted: true, file: file('deed.pdf', pdf('Deed')), text: 'Confidential settlement of the zebra dispute.' })
  const open = await tm.requester.command('request.create', { title: 'Zebra crossing works', type: 'supplier', party: { name: 'Roadworks', kind: 'supplier' }, file: file('works.pdf', pdf('Works')), text: 'Works near the zebra crossing.' })
  const search = async (client, q) => (await (await client.request(`/api/locket/search?q=${encodeURIComponent(q)}`)).json()).results.map(r => r.id)
  assert.deepEqual(await search(tm.requester, 'zebra'), [open.id])
  assert.deepEqual((await search(tm.counsel, 'zebra')).sort(), [secret.id, open.id].sort())
  assert.deepEqual(await search(viewer, 'settlement'), [])
  const s = await tm.counsel.state()
  const deedFile = s.artifacts.find(f => f.agreement_id === secret.id)
  assert.equal((await viewer.request(`/api/locket/files/${deedFile.id}`)).status, 404)
  assert.ok(!(await viewer.state()).agreements.some(a => a.id === secret.id))
  await viewer.command('comment.add', { agreementId: secret.id, versionId: secret.versionId, body: 'x' }, { error: 'FORBIDDEN' })
  await tm.requester.command('comment.add', { agreementId: secret.id, versionId: secret.versionId, body: 'x' }, { error: 'NOT_FOUND' })
  const a = await find(tm.counsel, secret.id)
  await tm.counsel.command('access.set', { agreementId: secret.id, operatorId: tm.requester.id, grant: 'grant' })
  assert.deepEqual((await search(tm.requester, 'settlement')), [secret.id])
  assert.ok(a)
  assert.equal((await viewer.request('/api/locket/export')).status, 403)
  const archive = await (await h.owner.request('/api/locket/export')).json()
  assert.equal(archive.format, 'locket-archive/1')
  assert.deepEqual(archive.records.lk_agreements.map(x => x.id).sort(), [secret.id, open.id].sort())
  assert.equal(archive.files.length, (await h.owner.state()).artifacts.length)
  for (const f of archive.files) assert.equal(sha(Buffer.from(f.base64, 'base64')), f.sha256)
})

test('AUDIT-001 approvals, restricted reads and downloads filter and export the same attributed trail', async t => {
  const h = await installation(); t.after(() => h.close())
  const tm = await team(h)
  const viewer = await h.invite('audit-viewer@example.test', 'viewer')
  const lib = await library(h, tm)
  const id = await approved(h, tm, lib, { title: 'Cascade supplier agreement', party: 'Cascade Supply Inc.' })
  const secret = await tm.counsel.command('request.create', { title: 'Confidential acquisition NDA', type: 'nda', restricted: true, party: { name: 'Cascade Holdings Inc.', kind: 'other' }, file: file('nda.pdf', pdf('Confidential NDA')), text: 'Confidential acquisition terms.' })
  const prior = await tm.counsel.state()
  const artifact = prior.artifacts.find(x => x.agreement_id === secret.id)
  const response = await tm.counsel.request(`/api/locket/files/${artifact.id}`)
  assert.equal(response.status, 200)
  assert.equal(sha(Buffer.from(await response.arrayBuffer())), artifact.sha256)
  assert.equal((await tm.counsel.request('/api/locket/search?q=acquisition')).status, 200)
  const firstVersion = prior.versions.find(x => x.agreement_id === secret.id)
  const revised = await tm.counsel.command('version.upload', { agreementId: secret.id, version: prior.agreements.find(x => x.id === secret.id).version, kind: 'counterparty', file: file('nda-v2.docx', docx(['Confidential acquisition terms revised.'])) })
  assert.equal((await tm.counsel.request('/api/locket/compare?' + new URLSearchParams({ from: firstVersion.id, to: revised.versionId }))).status, 200)
  const trail = async (person, params = '') => {
    const res = await person.request('/api/locket/audit' + params)
    assert.equal(res.status, 200)
    return (await res.json()).rows
  }
  let rows = await trail(tm.owner)
  const approval = rows.find(x => x.agreement_id === id && x.action === 'approval.approved')
  assert.ok(approval)
  assert.equal(approval.actor_id, tm.approver.id)
  assert.equal(approval.actor_role, 'approver')
  assert.ok(approval.actor_name && approval.summary && approval.at)
  assert.ok(rows.some(x => x.agreement_id === secret.id && x.action === 'agreement.view' && x.actor_id === tm.counsel.id))
  assert.ok(rows.some(x => x.agreement_id === secret.id && x.action === 'agreement.view' && x.summary.includes('search results')))
  assert.ok(rows.some(x => x.agreement_id === secret.id && x.action === 'agreement.view' && x.summary.includes('Compared')))
  const downloaded = rows.find(x => x.agreement_id === secret.id && x.action === 'file.download')
  assert.equal(downloaded.actor_id, tm.counsel.id)
  assert.match(downloaded.summary, new RegExp(artifact.sha256))
  const date = new Date(approval.at).toISOString().slice(0, 10)
  const filters = new URLSearchParams({ person: tm.approver.id, agreement: id, action: 'approval.approved', from: date, to: date })
  const filtered = await trail(tm.counsel, '?' + filters)
  assert.deepEqual(filtered.map(x => x.id).sort(), rows.filter(x => x.actor_id === tm.approver.id && x.agreement_id === id && x.action === 'approval.approved' && new Date(x.at).toISOString().slice(0, 10) === date).map(x => x.id).sort())
  assert.ok(filtered.length)
  for (const [key, value] of [['person', tm.counsel.id], ['agreement', secret.id], ['action', 'file.download'], ['q', 'Confidential']]) {
    const matches = await trail(tm.owner, '?' + new URLSearchParams({ [key]: value }))
    assert.deepEqual(matches.map(x => x.id).sort(), rows.filter(x => key === 'q' ? `${x.actor_name} ${x.action} ${x.summary}`.toLowerCase().includes(value.toLowerCase()) : x[{ person: 'actor_id', agreement: 'agreement_id', action: 'action' }[key]] === value).map(x => x.id).sort())
  }
  const tomorrow = new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)
  assert.deepEqual(await trail(tm.owner, '?' + new URLSearchParams({ agreement: id, action: 'approval.approved', from: tomorrow })), [])
  assert.deepEqual(await trail(tm.owner, '?' + new URLSearchParams({ agreement: id, action: 'approval.approved', to: new Date(Date.parse(date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10) })), [])
  for (const query of ['?from=2026-02-30', '?from=2026-10-20&to=2026-10-19']) assert.equal((await tm.owner.request('/api/locket/audit' + query)).status, 400)
  const csv = await tm.counsel.request('/api/locket/audit?' + filters + '&format=csv')
  assert.equal(csv.status, 200)
  assert.match(csv.headers.get('content-type'), /text\/csv/)
  const lines = (await csv.text()).trim().split('\r\n')
  assert.equal(lines.length - 1, filtered.length)
  assert.deepEqual(lines.slice(1).map(line => line.split(',')[0].replaceAll('"', '')).sort(), filtered.map(x => x.id).sort())
  assert.ok(lines.slice(1).every(line => line.includes('approver') && line.includes(id)))
  assert.ok((await trail(tm.owner)).some(x => x.action === 'audit.export' && x.actor_id === tm.counsel.id))
  const beforeRefusal = (await trail(tm.owner)).length
  assert.equal((await viewer.request(`/api/locket/files/${artifact.id}`)).status, 404)
  for (const person of [viewer, tm.requester, tm.approver]) {
    assert.equal((await person.request('/api/locket/audit')).status, 403)
    assert.equal((await person.request('/api/locket/audit?format=csv')).status, 403)
  }
  assert.equal((await trail(tm.owner)).length, beforeRefusal)
  assert.ok(!(await viewer.state()).audit.some(x => x.agreement_id === secret.id))
  const archive = await (await tm.owner.request('/api/locket/export')).json()
  assert.deepEqual(archive.records.lk_audit.map(x => x.id).sort(), (await trail(tm.owner)).map(x => x.id).sort())
})

test('configurable supplier forms preview conditions and routes, publish immutable versions and enforce launch membership', async t => {
  const { supplierForm } = await import('./intake-form-fixture.mjs')
  const h=await installation();t.after(()=>h.close())
  const tm=await team(h), outsider=await h.invite('outside@example.test','requester')
  const group=await tm.owner.command('audience.save',{name:'Procurement',kind:'group',memberIds:[tm.requester.id]})
  const department=await tm.owner.command('audience.save',{name:'Purchasing',kind:'department',memberIds:[tm.requester.id]})
  await tm.counsel.command('audience.save',{name:'Denied',kind:'group',memberIds:[]},{error:'FORBIDDEN'})
  await tm.owner.command('audience.save',{id:group.id,version:group.version,name:'Procurement',kind:'group',memberIds:['synthetic-locket-1']},{error:'INVALID'})
  const def=supplierForm({ownerId:tm.approver.id,reviewerId:tm.counsel.id,audienceId:group.id,highRole:'approver'})
  await tm.requester.command('form.save',{definition:def},{error:'FORBIDDEN'})
  const draft=await tm.counsel.command('form.save',{definition:def})
  const req=(title,value,extra={})=>({title,type:'supplier',party:{name:'Form supplier',kind:'supplier'},value,...extra})
  await tm.requester.command('request.create',req('Unpublished','60000',{formVersionId:draft.id}),{error:'NOT_FOUND'})
  const first=await tm.counsel.command('form.publish',draft)
  const early=await tm.requester.command('request.create',req('Already in flight','60000',{formVersionId:first.versionId,formAnswers:{security:'Enhanced review'}}))
  const before=(await tm.owner.state()).requestForms.find(f=>f.agreement_id===early.id)
  assert.equal(before.approval_role,'approver')
  def.rules[0].route.approvalRole='counsel'
  const revised=await tm.counsel.command('form.save',{id:draft.id,version:first.version,definition:def})
  await tm.counsel.command('form.save',{id:draft.id,version:first.version,definition:def},{error:'STALE'})
  const low=await tm.counsel.command('form.preview',{...revised,answers:{value:'49999.99'}})
  const high=await tm.counsel.command('form.preview',{...revised,answers:{value:'50000.01'}})
  assert.equal(low.route.approvalRole,'approver');assert.equal(low.fields.length,0)
  assert.deepEqual(low.requirements.sort(),['Certificate of insurance','Form W-9','Pricing schedule'])
  assert.equal(high.route.approvalRole,'counsel');assert.equal(high.route.reviewerId,tm.counsel.id)
  assert.equal(high.fields[0].key,'security');assert.ok(high.requirements.includes('Security questionnaire'))
  const exact=await tm.counsel.command('form.preview',{...revised,answers:{value:'50000'}})
  assert.equal(exact.route.approvalRole,'approver')
  const pub=await tm.counsel.command('form.publish',revised)
  const after=await tm.owner.state()
  assert.deepEqual(after.requestForms.find(f=>f.agreement_id===early.id),before)
  assert.deepEqual(after.routes[early.id][0].roles,['owner','approver'])
  assert.equal((await outsider.state()).intakeForms.length,0)
  assert.equal((await outsider.state()).intakeAudiences.length,0)
  assert.equal((await tm.requester.state()).intakeForms[0].definition.rules[0].route.approvalRole,'counsel')
  await outsider.command('request.create',req('Forged launch','60000',{formVersionId:pub.versionId,formAnswers:{security:'Enhanced review'}}),{error:'FORBIDDEN'})
  await outsider.command('request.create',req('Omitted form','60000'),{error:'FORM_REQUIRED'})
  await tm.requester.command('request.create',req('Old publication','60000',{formVersionId:first.versionId}),{error:'NOT_FOUND'})
  await tm.requester.command('request.create',req('Missing answer','60000',{formVersionId:pub.versionId}),{error:'FIELDS'})
  await tm.requester.command('request.create',req('Unknown option','60000',{formVersionId:pub.versionId,formAnswers:{security:'Unknown'}}),{error:'INVALID'})
  await tm.requester.command('request.create',req('Department spoof','1000',{formVersionId:pub.versionId,formAnswers:{department:group.id}}),{error:'INVALID'})
  const ids=[]
  for(const [value,expected,answers] of [['49999.99','approver',{security:'Forged hidden answer'}],['50000.01','counsel',{security:'Enhanced review',department:department.id,region:'US East'}]]) {
    const id=(await tm.requester.command('request.create',req(`Supplier ${value}`,value,{formVersionId:pub.versionId,formAnswers:answers,ownerId:outsider.id,file:file('agreement.pdf',pdf('Supplier contract '+value)),text:'Supplier contract '+value}))).id
    ids.push(id)
    let s=await tm.owner.state(),a=s.agreements.find(a=>a.id===id),snapshot=s.requestForms.find(f=>f.agreement_id===id)
    assert.equal(a.owner_id,tm.approver.id);assert.equal(snapshot.approval_role,expected)
    await tm.requester.command('request.update',{agreementId:id,version:a.version,value:'90000'},{error:'FORM_ROUTE'})
    await tm.requester.command('approval.inputs',{agreementId:id,version:a.version,risk:'high',dataProcessing:true},{error:'FORM_ROUTE'})
    assert.deepEqual((await tm.owner.state()).requestForms.find(f=>f.agreement_id===id),snapshot)
    await tm.requester.command('request.update',{agreementId:id,version:a.version,ownerId:outsider.id},{error:'FORM_ROUTE'})
    assert.deepEqual(s.routes[id][0].roles,['owner',expected])
    if(expected==='approver') assert.equal(JSON.parse(snapshot.answers).security,undefined)
    else assert.equal(JSON.parse(snapshot.answers).security,'Enhanced review')
    await tm.requester.command('agreement.submit',{agreementId:id,version:a.version},{error:'MISSING_ATTACHMENTS'})
    for(const r of s.requirements.filter(r=>r.agreement_id===id)) await tm.requester.command('requirement.attach',{agreementId:id,requirementId:r.id,file:file(r.label+'.pdf',pdf(r.label))})
    a=await find(tm.owner,id)
    await tm.requester.command('agreement.submit',{agreementId:id,version:a.version})
    a=await find(tm.owner,id)
    if(expected==='counsel') {
      await tm.approver.command('approval.decide',{agreementId:id,version:a.version,versionId:a.current_version_id,kind:'commercial',decision:'approved'},{error:'FORBIDDEN'})
      await tm.requester.command('approval.email',{agreementId:id,version:a.version,versionId:a.current_version_id,recipientId:tm.approver.id},{error:'RECIPIENT'})
      await tm.requester.command('approval.email',{agreementId:id,version:a.version,versionId:a.current_version_id,recipientId:tm.counsel.id})
      assert.ok((await tm.owner.state()).approvalReminders.pending.some(p=>p.agreementId===id && p.approverId===tm.counsel.id))
    }
    const decider=expected==='counsel'?tm.counsel:tm.approver
    await decider.command('approval.decide',{agreementId:id,version:a.version,versionId:a.current_version_id,kind:'commercial',decision:'approved'})
    assert.equal((await find(tm.owner,id)).status,'approved')
  }
  const allFields=[['memo','text'],['seats','number'],['budget','money'],['day','date'],['steward','person'],['affiliate','counterparty'],['evidence','file']].map(([key,kind])=>({key,label:key,kind,required:false,options:[]}))
  const typed=structuredClone(def);typed.fields.push(...allFields)
  typed.rules.unshift({name:'Risk in region and department',when:[{field:'type',op:'eq',value:'supplier'},{field:'department',op:'eq',value:department.id},{field:'region',op:'eq',value:'US East'},{field:'security',op:'eq',value:'Enhanced review'}],route:typed.rules[0].route,requirements:['Risk assessment']})
  const next=await tm.owner.command('form.save',{id:draft.id,version:pub.version,definition:typed})
  const nextPub=await tm.owner.command('form.publish',next)
  let s=await tm.owner.state()
  const answers={security:'Enhanced review',department:department.id,region:'US East',memo:'Counsel review',seats:'25.5',budget:'1200.50',day:'2027-02-01',steward:tm.approver.id,affiliate:s.agreements.find(a=>a.id===ids[0]).party_id,evidence:file('support.pdf',pdf('Exact supporting evidence'))}
  await tm.requester.command('request.create',req('Bad numeric answer','60000',{formVersionId:nextPub.versionId,formAnswers:{...answers,seats:'NaN'}}),{error:'INVALID'})
  await tm.requester.command('request.create',req('Bad date answer','60000',{formVersionId:nextPub.versionId,formAnswers:{...answers,day:'2027-02-30'}}),{error:'INVALID'})
  const typedRequest=await tm.requester.command('request.create',req('Typed answers','60000',{formVersionId:nextPub.versionId,formAnswers:answers}))
  s=await tm.owner.state()
  const snapshot=s.requestForms.find(f=>f.agreement_id===typedRequest.id),stored=JSON.parse(snapshot.answers)
  assert.equal(snapshot.matched_rule,'Risk in region and department')
  assert.equal(stored.seats,'25.5');assert.equal(stored.budget,'1200.50');assert.equal(stored.day,'2027-02-01');assert.equal(stored.steward,tm.approver.id);assert.equal(stored.affiliate,answers.affiliate)
  assert.deepEqual(await download(tm.owner,stored.evidence.artifactId),pdf('Exact supporting evidence'))
  assert.ok(s.requirements.some(r=>r.agreement_id===typedRequest.id && r.label==='Risk assessment'))
  const privateRequest=await tm.requester.command('request.create',req('Restricted typed answers','60000',{restricted:true,formVersionId:nextPub.versionId,formAnswers:answers}))
  const hidden=await outsider.state()
  assert.ok(!hidden.requestForms.some(f=>f.agreement_id===privateRequest.id))
  const privateAnswers=JSON.parse((await tm.owner.state()).requestForms.find(f=>f.agreement_id===privateRequest.id).answers)
  assert.equal((await outsider.request('/api/locket/files/'+privateAnswers.evidence.artifactId)).status,404)
  const archive=await (await tm.owner.request('/api/locket/export')).json()
  for(const [action,actorId,role] of [['audience.save',after.actor.id,'owner'],['form.save',tm.counsel.id,'counsel'],['form.preview',tm.counsel.id,'counsel'],['form.publish',tm.counsel.id,'counsel']]) {
    assert.ok(archive.records.lk_audit.some(row=>row.action===action && row.actor_id===actorId && row.actor_role===role && row.at>0 && row.summary),action+' retains attributed audit evidence')
  }
  assert.ok(archive.records.lk_intake_form_versions.some(v=>v.id===first.versionId))
  assert.deepEqual(archive.records.lk_request_forms.find(f=>f.agreement_id===typedRequest.id).answers,snapshot.answers)
  await tm.owner.command('audience.save',{id:group.id,version:group.version,name:'Procurement',kind:'group',memberIds:[]})
  assert.equal((await tm.requester.state()).intakeForms.length,0)
  await tm.requester.command('request.create',req('Revoked membership','60000',{formVersionId:nextPub.versionId,formAnswers:answers}),{error:'FORBIDDEN'})
  assert.equal((await tm.owner.state()).requestForms.find(f=>f.agreement_id===early.id).form_version_id,first.versionId)
})


test('INTAKE-006 rotates a guarded team queue, escalates once through personal notifications and preserves reasoned cancellations', async t => {
 // Digest assertions run after 9am in the configured New York zone.
 const clock=Date.parse('2026-10-20T14:00:00Z')
 const h=await installation({bindings:{TEST_NOW:String(clock)}});t.after(()=>h.close())
 const tm=await team(h), viewer=await h.invite('synthetic-locket-viewer@example.test','viewer')
 const ownerId=(await h.owner.state()).actor.id
 const group=await h.owner.command('audience.save',{name:'synthetic-locket-1',kind:'group',memberIds:[tm.counsel.id,tm.requester.id]})
 await viewer.command('queue.configure',{type:'nda',audienceId:group.id,leadId:ownerId,businessDays:2,version:0},{error:'FORBIDDEN'})
 await h.owner.command('queue.configure',{type:'nda',audienceId:group.id,leadId:ownerId,businessDays:2,version:0})
 await h.owner.command('queue.configure',{type:'nda',audienceId:group.id,leadId:ownerId,businessDays:3,version:0},{error:'STALE'})
 const ids=[]
 for(let i=1;i<=3;i++)ids.push((await tm.requester.command('request.create',{title:'synthetic-locket-'+i,type:'nda',ownerId,neededBy:'2026-12-01',party:{name:'synthetic-locket-counterparty',kind:'customer'},file:file('synthetic-locket-'+i+'.pdf',pdf('NDA '+i)),text:'Mutual confidentiality '+i})).id)
 let state=await h.owner.state(), work=ids.map(id=>state.requestQueue.work.find(w=>w.agreement_id===id))
 const order=[tm.counsel.id,tm.requester.id].sort()
 assert.deepEqual(work.map(w=>w.assignee_id),[order[0],order[1],order[0]])
 assert.ok(work.every(w=>w.team_id===group.id&&w.business_days===2&&w.sla==='on_track'))
 let a=await find(tm.requester,ids[0])
 await tm.requester.command('request.reassign',{agreementId:a.id,version:a.version,assigneeId:tm.counsel.id,reason:''},{error:'INVALID'})
 await viewer.command('request.reassign',{agreementId:a.id,version:a.version,assigneeId:ownerId,reason:'Cover absence'},{error:'FORBIDDEN'})
 await tm.requester.command('request.reassign',{agreementId:a.id,version:a.version,assigneeId:ownerId,reason:'Cover absence'})
 await tm.requester.command('request.reassign',{agreementId:a.id,version:a.version,assigneeId:tm.counsel.id,reason:'Stale change'},{error:'STALE'})
 a=await find(tm.requester,a.id)
 await tm.requester.command('agreement.submit',{agreementId:a.id,version:a.version})
 a=await find(tm.requester,a.id)
 await tm.requester.command('request.stage',{agreementId:a.id,version:a.version,stage:'negotiation',reason:'Counterparty markups'})
 a=await find(tm.requester,a.id)
 const before=await h.owner.state(), keptVersions=before.versions.filter(v=>v.agreement_id===a.id)
 await viewer.command('request.cancel',{agreementId:a.id,version:a.version,reason:'deal_lost'},{error:'FORBIDDEN'})
 await tm.requester.command('request.cancel',{agreementId:a.id,version:a.version,reason:'other'},{error:'INVALID'})
 await tm.requester.command('request.cancel',{agreementId:a.id,version:a.version,reason:'deal_lost'})
 state=await h.owner.state()
 assert.equal(state.agreements.find(x=>x.id===a.id).status,'cancelled')
 assert.deepEqual(state.versions.filter(v=>v.agreement_id===a.id),keptVersions)
 assert.equal(state.requestQueue.cancellations.find(c=>c.agreement_id===a.id).stage,'negotiation')
 let analytics=await (await h.owner.request('/api/locket/analytics')).json()
 assert.equal(analytics.canceled.filter(c=>c.agreementId===a.id&&c.reason==='deal_lost'&&c.stage==='negotiation').length,1)
 await tm.requester.command('request.reopen',{agreementId:a.id,version:(await find(tm.requester,a.id)).version,reason:'Deal resumed'},{error:'FORBIDDEN'})
 await tm.counsel.command('request.reopen',{agreementId:a.id,version:(await find(tm.counsel,a.id)).version,reason:'Deal resumed'})
 state=await h.owner.state()
 assert.equal(state.agreements.find(x=>x.id===a.id).status,'in_review')
 assert.equal(state.requestQueue.cancellations.find(c=>c.agreement_id===a.id).reopen_reason,'Deal resumed')
 assert.equal((await (await h.owner.request('/api/locket/analytics')).json()).canceled.length,1)
 // Shared notification inheritance: preferences, own-zone digest and no title/text in mail.
 await h.owner.command('notification.preferences',{inApp:true,email:true,digest:true,timezone:'America/New_York'})
 const due=Math.max(...state.requestQueue.work.map(w=>w.due_at))
 const at=due+86400000
 await h.setTime(at);await h.scheduled(at)
 const received=h.mails.length
 await h.scheduled(at)
 assert.equal(h.mails.length,received,'one-use SLA/digest claims prevent repeated sends')
 state=await h.owner.state()
 assert.ok(state.requestQueue.work.filter(w=>ids.includes(w.agreement_id)).every(w=>w.sla==='overdue'))
 assert.ok(state.notifications.items.some(n=>n.kind==='queue_overdue'&&n.agreement_id===ids[1]))
 const last=h.mails.at(-1)
 assert.equal(last.subject,'Your daily Locket notifications')
 assert.ok(!last.text.includes('synthetic-locket-1'))
 assert.match(last.text,/Sign in/)
 assert.ok(state.notifications.items.filter(n=>n.kind==='queue_overdue').every(n=>n.email_status==='accepted'))
 const archive=await(await h.owner.request('/api/locket/export')).json()
 assert.equal(archive.records.lk_request_cancellations.length,1)
 assert.equal(archive.records.lk_request_work.length,3)
 assert.ok(archive.records.lk_audit.some(e=>e.action==='request.reassign'&&e.summary.includes('Cover absence')))
 // Cancel after approval and manual handoff: keep evidence but withdraw decisions/packages.
 let second=await find(tm.requester,ids[1])
 await tm.requester.command('agreement.submit',{agreementId:second.id,version:second.version})
 second=await find(h.owner,second.id)
 await h.owner.command('approval.decide',{agreementId:second.id,version:second.version,versionId:second.current_version_id,kind:'commercial',decision:'approved'})
 second=await find(h.owner,second.id)
 const pkg=await h.owner.command('package.prepare',{agreementId:second.id,version:second.version,provider:'paper',recipients:[{name:'synthetic-locket-signer',email:'synthetic-locket-signer@example.test',action:'sign'}]})
 second=await find(h.owner,second.id)
 await h.owner.command('package.sent',{agreementId:second.id,version:second.version,packageId:pkg.packageId,envelopeId:'synthetic-locket-envelope'})
 second=await find(h.owner,second.id)
 await h.owner.command('request.cancel',{agreementId:second.id,version:second.version,reason:'no_longer_needed'})
 const closed=await h.owner.state()
 assert.ok(closed.approvals.filter(x=>x.agreement_id===second.id).every(x=>x.invalidated_at))
 assert.equal(closed.packages.find(x=>x.id===pkg.packageId).status,'voided')
 assert.equal(closed.requestQueue.work.find(x=>x.agreement_id===second.id).sla,'closed')
 assert.ok(!closed.approvalReminders.pending.some(x=>x.agreementId===second.id))
 await h.scheduled(at+3600000)
 assert.ok(!(await h.owner.state()).notifications.items.some(n=>n.agreement_id===second.id&&n.kind==='queue_overdue'&&n.email_status==='pending'))
 // Restricted requests never broaden access just because someone joins the team.
 await h.owner.command('queue.configure',{type:'nda',audienceId:group.id,leadId:ownerId,businessDays:2,version:1})
 const hidden=await h.owner.command('request.create',{title:'synthetic-locket-private',type:'nda',restricted:true,party:{name:'synthetic-locket-private-party',kind:'customer'}})
 assert.equal((await h.owner.state()).requestQueue.work.find(w=>w.agreement_id===hidden.id).assignee_id,tm.counsel.id)
 assert.ok(!(await tm.requester.state()).agreements.some(x=>x.id===hidden.id))
})


test('APPROVE-002 publishes previewed conditional routes, orders exact-version decisions and attributes current away delegates',async t=>{
 const {approvalRuleFixture,ruleRequest,ruleDecision}=await import('./approval-rule-fixture.mjs')
 // Keep the full journey, including the six-day reminder, after own-zone 9am.
 const clock=Date.parse('2026-10-20T14:00:00Z')
 const h=await installation({bindings:{TEST_NOW:String(clock)}});t.after(()=>h.close())
 const f=await approvalRuleFixture(h),viewer=await h.invite('synthetic-locket-approval-viewer@example.test','viewer')
 const beforeRules=await ruleRequest(h.owner,f.requester,f.department.id,{title:'synthetic-locket-before-rules'})
 await f.requester.command('approval.rules.save',{version:0,rules:f.rules},{error:'FORBIDDEN'})
 await h.owner.command('approval.rules.save',{version:0,rules:f.rules})
 await h.owner.command('approval.rules.publish',{version:1},{error:'PREVIEW'})
 const sample={type:'supplier',value:'600000',departmentId:f.department.id,risk:'medium',dataProcessing:true,findingKeys:[]}
 const below=await h.owner.command('approval.rules.preview',{version:1,sample:{...sample,value:'99999.99',dataProcessing:false}})
 assert.deepEqual(below.steps,[])
 const threshold=await h.owner.command('approval.rules.preview',{version:1,sample:{...sample,value:'100000',dataProcessing:false}})
 assert.deepEqual(threshold.steps.map(s=>s.name),['Finance'])
 const preview=await h.owner.command('approval.rules.preview',{version:1,sample})
 assert.deepEqual(preview.steps.map(s=>[s.name,s.order]),[['Finance',1],['Security',2],['CFO',3]])
 const published=await h.owner.command('approval.rules.publish',{version:1})
 let oldDraft=await find(f.requester,beforeRules)
 await f.requester.command('agreement.submit',{agreementId:beforeRules,version:oldDraft.version})
 assert.deepEqual((await h.owner.state()).routes[beforeRules].map(r=>r.label),['Commercial approval'])
 await h.owner.command('approval.rules.save',{version:0,rules:f.rules},{error:'STALE'})
 await h.owner.command('approval.availability',{operatorId:f.security.id,version:0,away:true,delegateId:f.delegate.id})
 await f.finance.command('approval.availability',{operatorId:f.security.id,version:1,away:false},{error:'FORBIDDEN'})
 const id=await ruleRequest(h.owner,f.requester,f.department.id)
 let a=await find(f.requester,id)
 await f.requester.command('agreement.submit',{agreementId:id,version:a.version})
 let state=await h.owner.state(),route=state.routes[id]
 assert.deepEqual(route.map(s=>s.label),['Finance','Security','CFO'])
 assert.equal(route[1].delegateId,f.delegate.id)
 assert.equal(state.rulePending.filter(p=>p.agreement_id===id).length,1)
 assert.equal(state.rulePending.find(p=>p.agreement_id===id).recipient_id,f.finance.id)
 assert.ok(state.approvalReminders.pending.some(p=>p.agreementId===id&&p.approverId===f.finance.id&&p.ruleStepId))
 assert.ok((await(await h.owner.request('/api/locket/analytics')).json()).approvalWaits.some(p=>p.agreementId===id&&p.approverId===f.finance.id))
 a=await find(f.requester,id)
 await f.requester.command('approval.email',{agreementId:id,version:a.version,versionId:a.current_version_id,recipientId:f.cfo.id},{error:'RECIPIENT'})
 await f.requester.command('approval.email',{agreementId:id,version:a.version,versionId:a.current_version_id,recipientId:f.finance.id})
 await ruleDecision(f.cfo,id,route[2].deviationId,{error:'ORDER'})
 await viewer.command('approval.decide',{agreementId:id,version:(await find(viewer,id)).version,versionId:a.current_version_id,kind:'commercial',deviationId:route[0].deviationId,decision:'approved'},{error:'FORBIDDEN'})
 // The same inbox, generic provider fake, own preferences and four-hour guard carry reminders.
 await f.finance.command('notification.preferences',{inApp:true,email:false,digest:false,timezone:'America/New_York'})
 a=await find(f.requester,id)
 await f.requester.command('approval.rule.remind',{agreementId:id,version:a.version,stepId:route[0].deviationId})
 await f.requester.command('approval.rule.remind',{agreementId:id,version:a.version,stepId:route[0].deviationId},{error:'TOO_SOON'})
 assert.ok((await f.finance.state()).notifications.items.some(n=>n.kind==='rule_approval_reminder'&&n.email_status==='suppressed'))
 await f.finance.command('notification.preferences',{inApp:true,email:true,digest:true,timezone:'America/New_York'})
 const due=clock+6*86400000
 await h.setTime(due);await h.scheduled(due)
 const calls=h.mails.length;await h.scheduled(due);assert.equal(h.mails.length,calls)
 assert.ok((await f.finance.state()).notifications.items.some(n=>n.kind==='rule_approval_reminder'&&n.email_status==='accepted'))
 assert.ok((await h.owner.state()).notifications.items.some(n=>n.kind==='rule_approval_escalation'))
 assert.ok(!h.mails.at(-1).text.includes('600000'))
 await ruleDecision(f.finance,id,route[0].deviationId)
 state=await h.owner.state();assert.equal(state.rulePending.filter(p=>p.agreement_id===id).length,1)
 assert.equal(state.rulePending.find(p=>p.agreement_id===id).recipient_id,f.delegate.id)
 a=await find(f.requester,id)
 await f.requester.command('approval.email',{agreementId:id,version:a.version,versionId:a.current_version_id,recipientId:f.delegate.id})
 await ruleDecision(f.security,id,route[1].deviationId,{error:'FORBIDDEN'})
 await h.owner.command('approval.availability',{operatorId:f.security.id,version:1,away:false,delegateId:f.delegate.id})
 await ruleDecision(f.delegate,id,route[1].deviationId,{error:'FORBIDDEN'})
 await h.owner.command('approval.availability',{operatorId:f.security.id,version:2,away:true,delegateId:f.delegate.id})
 await ruleDecision(f.delegate,id,route[1].deviationId)
 assert.equal((await ruleDecision(f.cfo,id,route[2].deviationId)).status,'approved')
 state=await h.owner.state()
 const live=state.approvals.filter(x=>x.agreement_id===id&&!x.invalidated_at)
 assert.equal(live.length,3)
 const delegated=live.find(x=>x.actor_id===f.delegate.id),attribution=state.ruleDecisions.find(d=>d.approval_id===delegated.id)
 assert.equal(attribution.approver_id,f.security.id);assert.equal(attribution.acted_as,'delegate');assert.equal(attribution.absence_version,3)
 assert.ok(live.every(x=>x.version_digest===state.versions.find(v=>v.id===a.current_version_id).digest))
 a=await find(f.requester,id)
 await f.requester.command('request.update',{agreementId:id,version:a.version,value:'650000'})
 state=await h.owner.state();assert.equal(state.agreements.find(a=>a.id===id).status,'in_review')
 assert.equal(state.approvals.filter(x=>x.agreement_id===id&&!x.invalidated_at).length,0)
 assert.equal(state.approvals.filter(x=>x.agreement_id===id&&x.invalidated_at).length,3)
 assert.equal(state.rulePending.find(p=>p.agreement_id===id).recipient_id,f.finance.id)
 // Preserve the owner's existing authority with explicit attribution, including an unavailable named role.
 await h.owner.command('role.set',{operatorId:f.finance.id,role:'viewer'})
 const ownerDecision=await ruleDecision(h.owner,id,route[0].deviationId)
 assert.equal((await h.owner.state()).ruleDecisions.find(d=>d.approval_id===ownerDecision.id).acted_as,'owner_override')
 await h.owner.command('role.set',{operatorId:f.finance.id,role:'approver'})
 // A newly published parallel route does not rewrite the existing snapshot.
 const parallel=f.rules.map((r,i)=>({...r,order:i<2?1:2}))
 await h.owner.command('approval.rules.save',{version:1,rules:parallel})
 await h.owner.command('approval.rules.preview',{version:2,sample})
 await h.owner.command('approval.rules.publish',{version:2})
 assert.deepEqual((await h.owner.state()).routes[id].map(r=>r.order),[1,2,3])
 const next=await ruleRequest(h.owner,f.requester,f.department.id,{title:'synthetic-locket-parallel'})
 a=await find(f.requester,next);await f.requester.command('agreement.submit',{agreementId:next,version:a.version})
 state=await h.owner.state();assert.deepEqual(state.routes[next].map(r=>r.order),[1,1,2]);assert.equal(state.rulePending.filter(p=>p.agreement_id===next).length,2)
 await ruleDecision(f.delegate,next,state.routes[next][1].deviationId)
 await ruleDecision(f.cfo,next,state.routes[next][2].deviationId,{error:'ORDER'})
 await ruleDecision(f.finance,next,state.routes[next][0].deviationId)
 assert.equal((await ruleDecision(f.cfo,next,state.routes[next][2].deviationId)).status,'approved')
 const archive=await(await h.owner.request('/api/locket/export')).json()
 assert.equal(archive.records.lk_approval_rule_snapshots.find(s=>s.agreement_id===id).ruleset_id,published.id)
 assert.equal(archive.records.lk_approval_rule_versions.length,2)
 assert.ok(archive.records.lk_rule_reminder_events.some(e=>e.kind==='manual'))
 // Away status never grants restricted agreement access to a delegate.
 const restricted=await ruleRequest(h.owner,f.requester,f.department.id,{title:'synthetic-locket-restricted-rule',restricted:true})
 a=await find(f.requester,restricted);await f.requester.command('agreement.submit',{agreementId:restricted,version:a.version})
 const hiddenRoute=(await h.owner.state()).routes[restricted]
 await f.delegate.command('approval.decide',{agreementId:restricted,version:(await find(h.owner,restricted)).version,versionId:a.current_version_id,kind:'commercial',deviationId:hiddenRoute.find(r=>r.label==='Security').deviationId,decision:'approved'},{error:'NOT_FOUND'})
 assert.ok(!(await f.delegate.state()).agreements.some(a=>a.id===restricted))
 // Runtime risk and person-recorded findings are conditions, not just preview labels.
 const riskRule={name:'High risk finding',approverId:f.finance.id,order:1,when:{risk:'high',findingKey:'liability'}}
 await h.owner.command('approval.rules.save',{version:2,rules:[riskRule]})
 const riskSample={...sample,risk:'high',findingKeys:['liability']}
 assert.equal((await h.owner.command('approval.rules.preview',{version:3,sample:riskSample})).steps.length,1)
 assert.equal((await h.owner.command('approval.rules.preview',{version:3,sample:{...riskSample,risk:'low'}})).steps.length,0)
 await h.owner.command('approval.rules.publish',{version:3})
 await library(h,{counsel:h.owner})
 const riskId=await ruleRequest(h.owner,f.requester,f.department.id,{title:'synthetic-locket-risk-finding',value:'50000',dataProcessing:false})
 a=await find(f.requester,riskId);await f.requester.command('approval.inputs',{agreementId:riskId,version:a.version,risk:'high',dataProcessing:false})
 a=await find(f.requester,riskId);await f.requester.command('agreement.submit',{agreementId:riskId,version:a.version})
 assert.ok(!(await h.owner.state()).routes[riskId].some(r=>r.label==='High risk finding'))
 state=await h.owner.state();a=state.agreements.find(a=>a.id===riskId);const v=state.versions.find(v=>v.id===a.current_version_id)
 await h.owner.command('deviation.add',{agreementId:riskId,versionId:v.id,clauseKey:'liability',result:'breached',start:0,end:v.text.length,quote:v.text,explanation:'Human accepted this finding for review.',questions:[]})
 assert.ok((await h.owner.state()).routes[riskId].some(r=>r.label==='High risk finding'))
 a=await find(f.requester,riskId);await f.requester.command('approval.inputs',{agreementId:riskId,version:a.version,risk:'low',dataProcessing:false})
 assert.ok(!(await h.owner.state()).routes[riskId].some(r=>r.label==='High risk finding'))
})

test('AGENT-007 measures thirty recorded negotiations, preserves twenty-two exact accepted citations and lets counsel scope a new playbook without rewriting history', async t => {
  const { negotiationFixture, recommendFixture, fallback, recommendationScope, minute, attachNegotiationRequirements } = await import('./playbook-recommendation-fixture.mjs')
  const { reconciliationBindings, reconciliationFake } = await import('./reconciliation-fixture.mjs')
  const { serviceLevelBindings, serviceLevelFake } = await import('./service-level-fixture.mjs')
  const creditCalls = [], uptimeCalls = []
  const accountingEdge=reconciliationFake(creditCalls),uptimeEdge=serviceLevelFake(uptimeCalls)
  const outboundResponse=async request=>{
    if(new URL(request.url).origin!==serviceLevelBindings.UPTIME_ORIGIN)return accountingEdge(request)
    const response=await uptimeEdge(request),body=await response.json()
    body.generatedAt=Date.parse('2026-10-26T00:00:00Z')
    return Response.json(body)
  }
  const h = await installation({ bindings: {...reconciliationBindings, ...serviceLevelBindings,TEST_NOW:String(Date.parse('2026-10-23T12:00:00Z'))}, outboundResponse }); t.after(() => h.close())
  const f = await negotiationFixture(h, { nativeCredit: true })
  const agent = await h.invite('synthetic-locket-agent@example.test', 'agent')
  const viewer = await h.invite('synthetic-locket-viewer@example.test', 'viewer')
  const before = await f.counsel.state(), first = f.rows[0]
  const signedBefore = await download(h.owner, first.signedArtifactId)
  const oldApprovals = before.approvals.filter(a => a.agreement_id === first.id)
  const oldFindings = before.deviations.filter(a => a.agreement_id === first.id)
  await viewer.command('negotiation.outcome.record', first.payload, { error: 'FORBIDDEN' })
  await f.counsel.command('negotiation.outcome.record', { ...first.payload, version: before.agreements.find(a => a.id === first.id).version, approvalId: f.rows[1].approvalId }, { error: 'APPROVAL' })
  await f.counsel.command('negotiation.outcome.record', { ...first.payload, version: before.agreements.find(a => a.id === first.id).version }, { error: 'ALREADY_RECORDED' })
  await h.owner.command('playbook.recommend', { sourcePlaybookId: f.source.id, clauseKey: 'liability', scope: f.scope }, { error: 'FORBIDDEN' })
  await agent.command('playbook.recommend', { sourcePlaybookId: f.source.id, clauseKey: 'liability', scope: f.scope }, { error: 'FORBIDDEN' })
  const recommendation = await recommendFixture(f), analysis = recommendation.analysis
  assert.equal(analysis.negotiations, 30)
  assert.equal(analysis.acceptedCount, 22)
  assert.equal(analysis.citations.length, 22)
  assert.equal(analysis.rejectedCount, 8)
  assert.equal(analysis.wording, fallback)
  assert.equal(analysis.cycleTime.predictedSavingMs, 20 * minute)
  assert.equal(analysis.cycleTime.affectedScenarioSavingMs, 22 * 20 * minute)
  assert.equal(analysis.cycleTime.unknownCount, 0)
  assert.equal(analysis.operations.issueCount, 3)
  assert.equal(analysis.operations.unknownAgreementCount, 21)
  assert.deepEqual(new Set(analysis.affectedAgreementIds), new Set(f.rows.slice(0, 22).map(r => r.id)))
  for (const citation of analysis.citations) {
    const v = before.versions.find(v => v.id === citation.versionId)
    assert.equal(v.text.slice(citation.start, citation.end), citation.quote)
    assert.equal(citation.digest, v.digest)
    assert.ok(before.approvals.some(p => p.id === citation.approvalId && p.deviation_id === citation.deviationId && p.version_id === v.id))
  }
  const native = analysis.citations.find(c=>c.agreementId===first.id).issues.find(i=>i.id===f.credit.id)
  assert.equal(native.nativeKind,'potential_overcharge')
  assert.equal(native.status,'proposed')
  assert.equal(native.negotiationVersionId,first.versionId)
  assert.equal(native.citation.versionId,first.versionId)
  assert.equal(native.citation.quote,f.credit.quote)
  assert.equal(native.citation.digest,before.versions.find(v=>v.id===first.versionId).digest)
  assert.equal(native.amountCents,400000)
  assert.equal(native.recoveryStatus,'unconfirmed')
  assert.equal(native.sourceChanged,false)
  assert.ok(creditCalls.length>0)
  const serviceNative=analysis.citations.find(c=>c.agreementId===first.id).issues.find(i=>i.id===f.credit.serviceCredit.id)
  assert.equal(serviceNative.nativeKind,'service_credit_claim')
  assert.equal(serviceNative.status,'proposed')
  assert.equal(serviceNative.negotiationVersionId,first.versionId)
  assert.equal(serviceNative.citation.versionId,first.versionId)
  assert.equal(serviceNative.citation.quote,f.credit.serviceCredit.quote)
  assert.equal(serviceNative.citation.digest,native.citation.digest)
  assert.equal(serviceNative.amountCents,100000)
  assert.equal(serviceNative.sourceEvidence.metrics.upMs/serviceNative.sourceEvidence.metrics.observedMs,0.992)
  assert.equal(serviceNative.recoveryStatus,'unconfirmed')
  assert.equal(serviceNative.sourceChanged,false)
  assert.ok(uptimeCalls.length>0)
  const performanceNative=analysis.creditEvidence.find(c=>c.id===f.credit.performanceCredit.id)
  assert.equal(performanceNative.nativeKind,'performance_credit_claim')
  assert.equal(performanceNative.status,'proposed')
  assert.equal(performanceNative.citation.versionId,first.versionId)
  assert.equal(performanceNative.citation.quote,f.credit.performanceCredit.quote)
  assert.equal(performanceNative.citation.digest,native.citation.digest)
  assert.equal(performanceNative.amountCents,150000)
  assert.equal(performanceNative.sourceEvidence.comparison.breachedCount,1)
  assert.equal(performanceNative.sourceEvidence.comparison.unknownCount,1)
  assert.equal(performanceNative.reportEvidence.id,f.credit.performanceCredit.reportId)
  assert.equal(performanceNative.reportEvidence.responseSha256,performanceNative.sourceEvidence.report.responseSha256)
  assert.equal(performanceNative.reportEvidence.artifactId,performanceNative.sourceEvidence.report.artifactId)
  assert.equal(performanceNative.reportEvidence.sourceReference,'synthetic-locket-performance-report-1')
  assert.equal(performanceNative.sourceChanged,false)
  assert.equal(performanceNative.authorityChanged,false)
  assert.equal(performanceNative.recoveryStatus,'unconfirmed')
  const decision = { recommendationId: recommendation.id, decision: 'approve', scope: recommendationScope, reason: 'Reviewed the recorded service credit and unknown operational outcomes. Limit the new alternative to future supplier reviews.' }
  await h.owner.command('playbook.recommendation.decide', decision, { error: 'FORBIDDEN' })
  await agent.command('playbook.recommendation.decide', decision, { error: 'FORBIDDEN' })
  await f.counsel.command('playbook.recommendation.decide', { ...decision, scope: { agreementTypes: ['nda'], entityIds: [] } }, { error: 'SCOPE' })
  // Native source decisions and provider outcomes invalidate the exact snapshot.
  await f.credit.approve()
  await f.credit.serviceCredit.approve()
  await f.credit.performanceCredit.approve()
  await f.counsel.command('playbook.recommendation.decide', decision, { error: 'STALE' })
  const creditApproved = await recommendFixture(f)
  const approvedCredit = creditApproved.analysis.creditEvidence.find(c=>c.id===f.credit.id)
  assert.equal(approvedCredit.status,'approved')
  assert.equal(approvedCredit.recoveryStatus,'unconfirmed')
  assert.ok(approvedCredit.approvedBy)
  const approvedServiceCredit=creditApproved.analysis.creditEvidence.find(c=>c.id===f.credit.serviceCredit.id)
  assert.equal(approvedServiceCredit.status,'approved')
  assert.equal(approvedServiceCredit.recoveryStatus,'unconfirmed')
  const approvedPerformance=creditApproved.analysis.creditEvidence.find(c=>c.id===f.credit.performanceCredit.id)
  assert.equal(approvedPerformance.status,'approved')
  assert.ok(approvedPerformance.approvedBy)
  assert.equal(approvedPerformance.recoveryStatus,'unconfirmed')
  await f.credit.send()
  await f.credit.serviceCredit.send()
  await f.credit.performanceCredit.send()
  await f.counsel.command('playbook.recommendation.decide', {...decision,recommendationId:creditApproved.id}, { error: 'STALE' })
  const creditSent=await recommendFixture(f)
  const acceptedCredit=creditSent.analysis.creditEvidence.find(c=>c.id===f.credit.id)
  assert.equal(acceptedCredit.dispatch.status,'accepted')
  assert.equal(acceptedCredit.recoveryStatus,'unconfirmed')
  const sentServiceCredit=creditSent.analysis.creditEvidence.find(c=>c.id===f.credit.serviceCredit.id)
  assert.equal(sentServiceCredit.dispatch.status,'accepted')
  assert.equal(sentServiceCredit.recoveryStatus,'unconfirmed')
  const sentPerformance=creditSent.analysis.creditEvidence.find(c=>c.id===f.credit.performanceCredit.id)
  assert.equal(sentPerformance.dispatch.status,'accepted')
  assert.equal(sentPerformance.recoveryStatus,'unconfirmed')
  // Retain exact historical credit evidence when its current source changes.
  const aBeforeRelink=await find(h.owner,first.id)
  await h.owner.command('accounting.link',{agreementId:first.id,version:aBeforeRelink.version,vendorId:'42',consent:true})
  await f.counsel.command('playbook.recommendation.decide', {...decision,recommendationId:creditSent.id}, { error: 'STALE' })
  const relinked=await recommendFixture(f)
  const retained=relinked.analysis.creditEvidence.find(c=>c.id===f.credit.id)
  assert.equal(retained.sourceChanged,true)
  assert.deepEqual(retained.citation,native.citation)
  assert.equal(retained.dispatch.status,'accepted')
  assert.equal(retained.recoveryStatus,'unconfirmed')
  const retainedService=relinked.analysis.creditEvidence.find(c=>c.id===f.credit.serviceCredit.id)
  assert.equal(retainedService.sourceChanged,true)
  assert.deepEqual(retainedService.citation,serviceNative.citation)
  assert.equal(retainedService.dispatch.status,'accepted')
  assert.equal(retainedService.recoveryStatus,'unconfirmed')
  const retainedPerformance=relinked.analysis.creditEvidence.find(c=>c.id===f.credit.performanceCredit.id)
  assert.equal(retainedPerformance.sourceChanged,true)
  assert.deepEqual(retainedPerformance.citation,performanceNative.citation)
  assert.deepEqual(retainedPerformance.reportEvidence,performanceNative.reportEvidence)
  assert.equal(retainedPerformance.dispatch.status,'accepted')
  assert.equal(retainedPerformance.recoveryStatus,'unconfirmed')
  // Counsel must revisit a proposal when a new operational issue arrives.
  await f.counsel.command('playbook.issue.record', { agreementId: first.id, version: (await find(f.counsel,first.id)).version, outcomeId: first.outcomeId, kind: 'dispute', description: 'A later dispute was recorded after analysis.', evidence: 'synthetic-locket-dispute-1: newly reported operational issue.' })
  await f.counsel.command('playbook.recommendation.decide', decision, { error: 'STALE' })
  const fresh = await recommendFixture(f)
  decision.recommendationId = fresh.id
  const approved = await f.counsel.command('playbook.recommendation.decide', decision)
  const after = await f.counsel.state()
  assert.equal(after.playbooks.find(p => p.id === approved.playbookId).status, 'active')
  assert.ok(JSON.parse(after.playbooks.find(p => p.id === approved.playbookId).rules)[0].alternatives.includes(fallback))
  assert.deepEqual(after.approvals.filter(a => a.agreement_id === first.id), oldApprovals)
  assert.deepEqual(after.deviations.filter(a => a.agreement_id === first.id), oldFindings)
  assert.equal(after.deviations.find(d => d.id === first.findingId).playbook_version_id, f.source.id)
  assert.deepEqual(await download(h.owner, first.signedArtifactId), signedBefore)
  assert.equal(after.agreements.find(a => a.id === first.id).status, 'executed')
  for (const type of ['supplier', 'nda']) {
    const contents = `synthetic-locket-scope-${type}\n${fallback}`
    const a = await h.owner.command('request.create', { title: `synthetic-locket-scope-${type}`, type, party: { name: `synthetic-locket-scope-${type}`, kind: 'supplier' }, file: file('synthetic-locket-scope.pdf', pdf(contents)), text: contents })
    const finding = await f.counsel.command('deviation.add', { agreementId: a.id, versionId: a.versionId, clauseKey: 'liability', result: 'met', start: contents.indexOf(fallback), end: contents.length, quote: fallback, explanation: 'Check the version chosen for this future review.', questions: [] })
    const state = await f.counsel.state()
    assert.equal(state.deviations.find(d => d.id === finding.id).playbook_version_id, type === 'supplier' ? approved.playbookId : f.source.id)
  }
  for (const client of [h.owner, viewer, agent]) assert.deepEqual((await client.state()).playbookRecommendations, { outcomes: [], issues: [], recommendations: [], applications: [] })
  const archive = await (await h.owner.request('/api/locket/export')).json()
  assert.ok(archive.records.lk_playbook_recommendations.some(r => r.id === recommendation.id))
  assert.equal(archive.records.lk_negotiation_outcomes.length, 30)
  await f.counsel.command('playbook.recommendation.decide', decision, { error: 'STATUS' })
  // A counterparty outcome without a closed approval interval or commercial
  // decision has no measured saving; the product must not supply a duration.
  const unmeasuredWording = 'Liability is capped at the fees paid in the prior 36 months.'
  const unmeasured = await h.owner.command('request.create', { title: 'synthetic-locket-unknown-time', type: 'supplier', party: { name: 'synthetic-locket-unknown-time', kind: 'supplier' }, file: file('synthetic-locket-unknown.pdf', pdf(unmeasuredWording)), text: unmeasuredWording })
  const finding = await f.counsel.command('deviation.add', { agreementId: unmeasured.id, versionId: unmeasured.versionId, clauseKey: 'liability', result: 'breached', start: 0, end: unmeasuredWording.length, quote: unmeasuredWording, explanation: 'Another explicit counterparty alternative.', questions: [] })
  await attachNegotiationRequirements(h.owner,unmeasured.id)
  await h.owner.command('agreement.submit', { agreementId: unmeasured.id, version: (await find(h.owner, unmeasured.id)).version })
  const exception = await f.counsel.command('approval.decide', { agreementId: unmeasured.id, version: (await find(f.counsel, unmeasured.id)).version, versionId: unmeasured.versionId, kind: 'exception', deviationId: finding.id, decision: 'approved' })
  await f.counsel.command('negotiation.outcome.record', { agreementId: unmeasured.id, version: (await find(f.counsel, unmeasured.id)).version, versionId: unmeasured.versionId, deviationId: finding.id, approvalId: exception.id, outcome: 'accepted', evidence: 'synthetic-locket-counterparty-reply-unknown: accepted exact 36-month wording.' })
  const unknown = await f.counsel.command('playbook.recommend', { sourcePlaybookId: approved.playbookId, clauseKey: 'liability', scope: f.scope })
  assert.equal(unknown.analysis.cycleTime.predictedSavingMs, null)
  assert.equal(unknown.analysis.cycleTime.measuredCount, 0)
  assert.equal(unknown.analysis.cycleTime.unknownCount, 1)
  assert.equal(unknown.analysis.operations.unknownAgreementCount, 1)
  await f.counsel.command('playbook.recommendation.decide', { recommendationId: unknown.id, decision: 'reject', reason: 'Insufficient timing and operational history for a standard position.' })
  assert.equal((await f.counsel.state()).playbooks.find(p => p.status === 'active').id, approved.playbookId)
})

test('legacy DOCX text is read only within the part sizes its package declares', async t => {
  const h = await installation(); t.after(() => h.close())
  const word = docx(['synthetic-locket-4 '.repeat(65536)])
  // The main document expands to over a megabyte while both headers declare one byte.
  const end = word.length - 22
  for (let at = word.readUInt32LE(end + 16); at < end; at += 46 + word.readUInt16LE(at + 28) + word.readUInt16LE(at + 30) + word.readUInt16LE(at + 32)) {
    if (word.toString('utf8', at + 46, at + 46 + word.readUInt16LE(at + 28)) !== 'word/document.xml') continue
    word.writeUInt32LE(1, at + 24)
    word.writeUInt32LE(1, word.readUInt32LE(at + 42) + 22)
  }
  await h.owner.command('legacy.import', { title: 'synthetic-locket-4 archive', type: 'nda', party: { name: 'synthetic-locket-4 party', kind: 'other' }, sourceSystem: 'Shared drive', sourceId: 'synthetic-locket-4.docx', file: file('synthetic-locket-4.docx', word) }, { error: 'DOCX' })
  assert.deepEqual((await h.owner.state()).agreements, [])
})

async function automaticRetrievalJourney(t) {
  let returned, certificate = pdf('synthetic-locket-1 certificate'), failDownload = true, changed = false, reads = 0
  const h = await installation({ bindings: { SIGNATURE_DOCUSIGN_TOKEN: 'synthetic-locket-1', SIGNATURE_DOCUSIGN_CONNECT_SECRET: 'synthetic-locket-2' }, outboundResponse: async request => {
    const path = new URL(request.url).pathname
    reads++
    if (path.endsWith('/recipients')) return Response.json({ signers: [{ name: 'Hana Park', email: 'hana@harbour.example', status: 'completed', signedDateTime: '2026-10-26T12:00:00Z' }, { name: 'Olive Owner', email: 'owner@example.test', status: 'completed', signedDateTime: '2026-10-26T12:00:00Z' }] })
    if (path.endsWith('/documents/combined')) return failDownload ? new Response('Unavailable', { status: 503 }) : new Response(changed ? pdf('Changed liability cap USD 999999') : returned, { headers: { 'content-type': 'application/pdf' } })
    if (path.endsWith('/documents/certificate')) return new Response(certificate)
    return Response.json({ envelopeId: decodeURIComponent(path.split('/').at(-1)), status: 'completed', completedDateTime: '2026-10-26T12:00:00Z' })
  } }); t.after(() => h.close())
  const tm = await team(h), lib = await library(h, tm)
  const { id, pkg } = await outForSignature(h, tm, lib)
  returned = await download(tm.owner, pkg.pdfArtifactId)
  await tm.owner.command('signature.connection.configure', { provider: 'docusign', baseUrl: 'https://demo.docusign.net/restapi/v2.1', accountId: 'synthetic-locket-1', version: 0 })
  let a = await find(tm.owner, id)
  const payload = { agreementId: id, version: a.version, packageId: pkg.packageId, consent: true }
  await tm.requester.command('execution.retrieval.authorize', payload, { error: 'FORBIDDEN' })
  await tm.owner.command('execution.retrieval.authorize', { ...payload, consent: false }, { error: 'CONSENT' })
  await tm.owner.command('execution.retrieval.authorize', payload)
  let s = await tm.owner.state(), job = s.executionRetrievals.find(r => r.agreement_id === id)
  assert.equal(job.status, 'retrying'); assert.equal(job.last_error, 'provider_http_503')
  assert.equal(s.agreements.find(a => a.id === id).status, 'out_for_signature')
  assert.equal(s.executions.filter(e => e.agreement_id === id).length, 0)
  const event={event:'envelope-completed',data:{accountId:'synthetic-locket-1',envelopeId:`ENV-${id.slice(0,8)}`}}
  const signature=createHmac('sha256','synthetic-locket-2').update(JSON.stringify(event)).digest('base64')
  const invalid=await h.request('/api/locket/events/docusign',{method:'POST',body:event,headers:{'x-docusign-signature-1':'invalid'}})
  assert.equal(invalid.status,403)
  const beforeEventReads=reads
  const valid=await h.request('/api/locket/events/docusign',{method:'POST',body:event,headers:{'x-docusign-signature-1':signature}})
  assert.equal(valid.status,204)
  assert.equal(reads,beforeEventReads,'a signed callback must not override failure backoff')
  const failedReads = reads
  await h.scheduled(job.next_attempt_at - 1)
  assert.equal(reads, failedReads, 'backoff must withhold early retries')
  // Repeated failed reads must reach the ceiling and remain there. Independent
  // delays also reject a constant ceiling that discards exponential backoff.
  const retryDelays = [60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000, 3_600_000]
  for (const delay of retryDelays) {
    const at = job.next_attempt_at, priorAttempts = job.attempts, beforeReads = reads
    await h.scheduled(at - 1)
    assert.equal(reads, beforeReads, 'each retry waits until its recorded due time')
    await h.scheduled(at)
    job = (await tm.owner.state()).executionRetrievals.find(r => r.agreement_id === id)
    assert.equal(job.status, 'retrying')
    assert.equal(job.attempts, priorAttempts + 1, 'one failed attempt is retained per due retry')
    assert.equal(job.next_attempt_at - at, delay, 'failed reads grow exponentially only up to the one-hour ceiling')
    assert.equal((await find(tm.owner, id)).status, 'out_for_signature')
  }
  failDownload = false
  await h.scheduled(job.next_attempt_at + 1)
  s = await tm.owner.state(); job = s.executionRetrievals.find(r => r.agreement_id === id)
  assert.equal(job.status, 'reconciled')
  assert.equal(s.agreements.find(a => a.id === id).status, 'executed')
  const execution = s.executions.find(e => e.id === job.execution_id)
  assert.equal(s.artifacts.find(f => f.id === execution.signed_artifact_id).sha256, sha(returned))
  assert.equal(s.artifacts.find(f => f.id === execution.certificate_artifact_id).sha256, sha(certificate))
  assert.deepEqual(await download(tm.owner, execution.signed_artifact_id), returned)
  assert.deepEqual(await download(tm.owner, execution.certificate_artifact_id), certificate)
  assert.ok((await tm.requester.state()).notifications.items.some(n => n.agreement_id === id && n.kind === 'signature'))
  const completedReads = reads
  await h.scheduled(job.next_attempt_at + 60_000)
  assert.equal(reads, completedReads, 'a completed job must not retrieve again')
  // A provider completion is not permission to execute a changed document.
  changed = true
  const other = await outForSignature(h, tm, lib, { title: 'Changed provider return', party: 'Other supplier' })
  a = await find(tm.owner, other.id)
  await tm.owner.command('execution.retrieval.authorize', { agreementId: a.id, version: a.version, packageId: other.pkg.packageId, consent: true })
  s = await tm.owner.state()
  assert.equal(s.executionRetrievals.find(r => r.agreement_id === a.id).status, 'needs_review')
  assert.equal(s.agreements.find(r => r.id === a.id).status, 'out_for_signature')
}

async function retrievalAuthorityJourney(t) {
  let returned, failDownload = true, beforeCertificate = null, failCertificate = false, reads = 0
  const certificate = pdf('synthetic-locket-3 certificate')
  const h = await installation({ bindings: { SIGNATURE_DOCUSIGN_TOKEN: 'synthetic-locket-3' }, outboundResponse: async request => {
    reads++
    const path = new URL(request.url).pathname
    if (path.endsWith('/recipients')) return Response.json({ signers: [{ name: 'Hana Park', email: 'hana@harbour.example', status: 'completed' }, { name: 'Olive Owner', email: 'owner@example.test', status: 'completed' }] })
    if (path.endsWith('/documents/combined')) return failDownload ? new Response('Unavailable', { status: 503 }) : new Response(returned)
    if (path.endsWith('/documents/certificate')) { if (beforeCertificate) { const action = beforeCertificate; beforeCertificate = null; await action() }; return failCertificate ? new Response('Unavailable', {status:503}) : new Response(certificate) }
    return Response.json({ envelopeId: decodeURIComponent(path.split('/').at(-1)), status: 'completed', completedDateTime: '2026-10-26T12:00:00Z' })
  } }); t.after(() => h.close())
  const tm = await team(h), lib = await library(h, tm)
  let connectionVersion = 0
  const connect = async () => { await tm.owner.command('signature.connection.configure', { provider: 'docusign', baseUrl: 'https://demo.docusign.net/restapi/v2.1', accountId: 'synthetic-locket-3', version: connectionVersion++ }) }
  await connect()
  for (const scenario of ['cancel', 'connection', 'connection-before', 'package', 'session', 'session-failure', 'session-before']) {
    failDownload = true; failCertificate = false
    const { id, pkg } = await outForSignature(h, tm, lib, { title: `synthetic-locket-3 ${scenario}`, party: `synthetic-locket-3 ${scenario}` })
    returned = await download(tm.owner, pkg.pdfArtifactId)
    const a = await find(tm.owner, id), payload = { agreementId: id, version: a.version, packageId: pkg.packageId, consent: true }
    const first = await tm.owner.command('execution.retrieval.authorize', payload)
    await tm.owner.command('execution.retrieval.authorize', payload, { error: 'RETRIEVAL_ACTIVE' })
    let job = (await tm.owner.state()).executionRetrievals.find(r => r.id === first.id)
    assert.equal(job.status, 'retrying')
    failDownload = false
    beforeCertificate = scenario === 'cancel' ? () => tm.owner.command('execution.retrieval.cancel', payload)
      : scenario.startsWith('connection') ? connect
      : scenario === 'package' ? () => tm.owner.command('package.void', { ...payload, reason: 'Owner withdrew this exact package.' })
      : async () => { const response = await tm.owner.request('/auth/signout', { method: 'POST', body: {} }); assert.equal(response.status, 204) }
    if (scenario.endsWith('-before')) { const action = beforeCertificate; beforeCertificate = null; await action() }
    failCertificate = scenario === 'session-failure'
    const beforeReads = reads
    await h.scheduled(job.next_attempt_at + 1)
    if (scenario.endsWith('-before')) assert.equal(reads, beforeReads, 'ended consent must refuse before any provider request')
    if (scenario.startsWith('session')) { tm.owner = await h.signIn('owner@example.test'); h.owner = tm.owner; tm.owner.id = (await tm.owner.state()).actor.id }
    let state = await tm.owner.state()
    job = state.executionRetrievals.find(r => r.id === first.id)
    assert.equal(job.status, 'cancelled', `${scenario} must end the old authorization`)
    assert.equal(state.executions.filter(e => e.agreement_id === id).length, 0)
    assert.equal(state.artifacts.filter(f => f.agreement_id === id && ['signed','certificate'].includes(f.role)).length, 0)
    assert.notEqual(state.agreements.find(a => a.id === id).status, 'executed')
    assert.equal((await tm.requester.state()).notifications.items.filter(n => n.event_key === first.id).length, 0)
    const retained = JSON.parse(job.outcomes)
    assert.deepEqual(retained.map(o => o.status), ['retrying', 'cancelled'])
    assert.equal(retained[0].code, 'provider_http_503')
    assert.equal(retained[1].code, scenario === 'cancel' ? 'owner_cancelled' : scenario.startsWith('session') ? 'AUTHORITY' : scenario === 'package' ? 'STATUS' : 'STALE', scenario)
    const stoppedReads = reads
    await h.scheduled(job.next_attempt_at + 3_600_001)
    assert.equal(reads, stoppedReads, 'a later login or connection must not revive old consent')
    if (scenario !== 'package') {
      failCertificate = false
      const renewed = await tm.owner.command('execution.retrieval.authorize', payload)
      assert.notEqual(renewed.id, first.id)
      state = await tm.owner.state()
      assert.equal(state.executionRetrievals.find(r => r.id === first.id).status, 'cancelled')
      const current = state.executionRetrievals.find(r => r.id === renewed.id)
      assert.equal(current.status, 'reconciled')
      assert.equal(state.agreements.find(a => a.id === id).status, 'executed')
      assert.equal(state.executionRetrievals.filter(r => r.agreement_id === id).length, 2)
      const archive = await (await tm.owner.request('/api/locket/export')).json()
      const decisions = archive.records.lk_execution_retrievals.filter(r => r.agreement_id === id)
      assert.equal(decisions.length, 2)
      const decision = decisions.find(r => r.id === renewed.id), binding = JSON.parse(decision.binding)
      assert.equal(binding.envelopeId, `ENV-${id.slice(0,8)}`)
      assert.equal(binding.packageId, pkg.packageId)
      assert.equal(binding.manifestDigest, sha(state.packages.find(p => p.id === pkg.packageId).manifest))
      assert.equal(binding.connection.version, connectionVersion)
      assert.equal(binding.connection.accountId, 'synthetic-locket-3')
      assert.deepEqual(binding.artifacts.map(f => f.sha256).sort(), [sha(returned), sha((await download(tm.owner, pkg.manifestArtifactId)))].sort())
      assert.equal(JSON.parse(decision.actor).sessionId, '', 'archives must redact the authorizing session credential')
      assert.ok(JSON.parse(decision.actor).id)
      assert.ok(decision.created_at)
      assert.deepEqual(JSON.parse(current.outcomes).map(o => o.status), ['reconciled'])
      assert.equal((await tm.requester.state()).notifications.items.filter(n => n.agreement_id === id && n.event_key === renewed.id && n.kind === 'signature').length, 1)
    }
  }
  await retrievalExpiryAndRoleJourney(t)
}

async function retrievalExpiryAndRoleJourney(t) {
  // These are changes to a valid consent, not initial wrong-role refusals.
  for (const scenario of ['expiry-before', 'role-before', 'role-result', 'role-failure']) {
    let signed, beforeCertificate = null, failDownload = true, reads = 0
    const certificate = pdf('synthetic-locket-31 certificate')
    const h = await installation({ bindings: { SIGNATURE_DOCUSIGN_TOKEN: 'synthetic-locket-31' }, outboundResponse: async request => {
      reads++
      const path = new URL(request.url).pathname
      if (path.endsWith('/recipients')) return Response.json({ signers: [{ name: 'Hana Park', email: 'hana@harbour.example', status: 'completed' }, { name: 'Olive Owner', email: 'owner@example.test', status: 'completed' }] })
      if (path.endsWith('/documents/combined')) return failDownload ? new Response('Unavailable', { status: 503 }) : new Response(signed)
      if (path.endsWith('/documents/certificate')) {
        if (beforeCertificate) { const change = beforeCertificate; beforeCertificate = null; await change() }
        return scenario === 'role-failure' ? new Response('Unavailable', { status: 503 }) : new Response(certificate)
      }
      return Response.json({ envelopeId: decodeURIComponent(path.split('/').at(-1)), status: 'completed', completedDateTime: '2026-10-26T12:00:00Z' })
    } })
    let closed = false
    const close = async () => { if (!closed) { closed = true; await h.close() } }
    t.after(close)
    await h.setTime(Date.parse('2026-10-27T12:00:00Z'))
    // Bootstrap precedes the pinned clock; use a fresh session at that clock.
    h.owner = await h.signIn('owner@example.test')
    const tm = await team(h), lib = await library(h, tm)
    const { id, pkg } = await outForSignature(h, tm, lib, { title: `synthetic-locket-31 ${scenario}`, party: `synthetic-locket-31 ${scenario}` })
    signed = await download(tm.owner, pkg.pdfArtifactId)
    await tm.owner.command('signature.connection.configure', { provider: 'docusign', baseUrl: 'https://demo.docusign.net/restapi/v2.1', accountId: 'synthetic-locket-31', version: 0 })
    const originalOwner = tm.owner, originalId = (await originalOwner.state()).actor.id
    const stepUp = async client => {
      assert.equal((await client.request('/auth/step-up', { method: 'POST', body: { action: 'owner:transfer' } })).status, 202)
      const link = new URL(h.mails.at(-1).text.match(/https?:\/\/[^\s]+/)[0])
      assert.equal((await client.request('/auth/confirm', { method: 'POST', body: { token: link.searchParams.get('token') } })).status, 303)
    }
    let observer = originalOwner
    if (scenario.startsWith('role')) {
      observer = await h.invite('synthetic-locket-retrieval-owner@example.test', 'viewer')
      await stepUp(originalOwner)
      const promoted = await originalOwner.request('/auth/operator/role', { method: 'POST', body: { operatorId: observer.id, role: 'owner' } })
      assert.equal(promoted.status, 200, await promoted.text())
      observer = await h.signIn('synthetic-locket-retrieval-owner@example.test')
      await stepUp(observer)
    }
    const a = await find(originalOwner, id), payload = { agreementId: id, version: a.version, packageId: pkg.packageId, consent: true }
    const first = await originalOwner.command('execution.retrieval.authorize', payload)
    let job = (await observer.state()).executionRetrievals.find(r => r.id === first.id)
    assert.equal(job.status, 'retrying', scenario + ': consent was valid at the initial failed read')
    failDownload = false
    const beforeReads = reads
    if (scenario === 'expiry-before') {
      const session = await (await originalOwner.request('/auth/session')).json()
      assert.ok(session.expiresAt > job.next_attempt_at)
      await h.setTime(session.expiresAt)
      assert.equal((await originalOwner.request('/auth/session')).status, 401, 'the authorizing session has actually expired')
      await h.scheduled(session.expiresAt)
      observer = await h.signIn('owner@example.test')
    } else {
      const demote = async () => {
        const response = await observer.request('/auth/operator/role', { method: 'POST', body: { operatorId: originalId, role: 'member' } })
        assert.equal(response.status, 200, await response.text())
      }
      if (scenario === 'role-before') await demote()
      else beforeCertificate = demote
      await h.scheduled(job.next_attempt_at)
      const demotedOwner = await h.signIn('owner@example.test')
      assert.notEqual((await demotedOwner.state()).actor.role, 'owner', 'the consenting person has actually lost the owner role')
    }
    h.owner = observer
    const state = await observer.state()
    job = state.executionRetrievals.find(r => r.id === first.id)
    assert.equal(job.status, 'cancelled', scenario + ': ended authority cannot record retrieval or another retry')
    assert.equal(job.last_error, 'AUTHORITY', scenario)
    assert.deepEqual(JSON.parse(job.outcomes).map(o => [o.status, o.code]), [['retrying', 'provider_http_503'], ['cancelled', 'AUTHORITY']], scenario + ': retain failure and authority outcomes')
    assert.equal(state.executions.filter(e => e.agreement_id === id).length, 0, scenario)
    assert.equal(state.artifacts.filter(f => f.agreement_id === id && ['signed', 'certificate'].includes(f.role)).length, 0, scenario)
    assert.equal(state.agreements.find(a => a.id === id).status, 'out_for_signature', scenario)
    if (scenario.endsWith('-before')) assert.equal(reads, beforeReads, scenario + ': refuse before any provider read')
    if (scenario.startsWith('role')) {
      await stepUp(observer)
      const restored = await observer.request('/auth/operator/role', { method: 'POST', body: { operatorId: originalId, role: 'owner' } })
      assert.equal(restored.status, 200, await restored.text())
    }
    const renewedOwner = await h.signIn('owner@example.test'), stoppedReads = reads
    assert.equal((await renewedOwner.state()).actor.role, 'owner')
    await h.scheduled(job.next_attempt_at + 3_600_001)
    assert.equal(reads, stoppedReads, scenario + ': later login or restored owner role cannot revive consent')
    assert.equal((await renewedOwner.state()).executionRetrievals.find(r => r.id === first.id).status, 'cancelled')
    await close()
  }
}

test('Accepted Platter and PandaDoc sources retain exact custody and become native requests with confirmed pending Nectar or Stripe handoffs', async t => {
  for (const variant of ['simple', 'rich-usd', 'rich-fx', 'pandadoc', 'stripe', 'stripe-uncertain', 'unreadable', 'mismatch-accepted']) {
  console.log('Proposal handoff case:',variant)
  const rich = variant.startsWith('rich-'), foreign = variant === 'rich-fx', panda=variant==='pandadoc', stripe=variant.startsWith('stripe')
  let status = 'draft', billingBody, billCalls = 0,pandaPdf
  const proposal = { id:'synthetic-locket-1',revision:1,title:'Customer subscription',clientName:'Synthetic customer',currency:'USD',scope:'Provide hosted services.',terms:'Start 2026-11-01. Initial term 12 months. Auto renewal 12 months. Notice 30 days. Renewal uplift 0%. Billing monthly in arrears. Not taxable.',options:[{id:'selected',cents:120000,tables:[{lines:[{name:'Service',description:'Hosted seats',quantity:'2',unitPrice:'500.00',lineTotalCents:100000},{name:'Support',description:'Annual support',quantity:'1',unitPrice:'200.00',lineTotalCents:20000}]}]}],acceptance:{revision:1,optionId:'selected',totalCents:120000,currency:'USD',acceptedAt:1793016000000} }
  if (rich) {
    proposal.currency = proposal.acceptance.currency = foreign ? 'GBP' : 'USD'
    const option = proposal.options[0]
    option.tables[0].lines[0] = {name:'Service',description:'Hosted seats',quantity:'1.5',unitPrice:'500.00',grossCents:75000,lineTotalCents:67500}
    option.cents = 78750
    option.discount = {bps:1000,grossCents:87500,cents:8750}
    option.optionalItems = [{id:'backup',label:'Premium backup',unitCents:10000,min:1,max:5,quantity:1,editable:true},{id:'unselected',label:'Not selected',unitCents:50000,min:1,max:1,quantity:1,editable:false}]
    proposal.acceptance.totalCents = 105750
    proposal.acceptance.selection = {optionId:'selected',totalCents:105750,discountCents:11750,items:[{id:'backup',label:'Premium backup',quantity:3,unitCents:10000,totalCents:30000}]}
  }
  const expectedTotal = foreign ? 132188 : rich ? 105750 : 120000
  const h = await installation({bindings:{TEST_NOW:'1793016000000',PLATTER_ORIGIN:'https://platter.example.test',PLATTER_TOKEN:'synthetic-locket-1',NECTAR_ORIGIN:'https://nectar.example.test',NECTAR_TOKEN:'synthetic-locket-2',PANDADOC_API_KEY:'synthetic-locket-3',STRIPE_SECRET_KEY:'synthetic-locket-4'},outboundResponse:async request=>{
    if(new URL(request.url).hostname==='api.pandadoc.com'){
      if(new URL(request.url).pathname.endsWith('/download-protected')){const {PDFDocument}=await import('pdf-lib');const doc=await PDFDocument.create();doc.addPage().drawText('Customer: Synthetic customer\n'+proposal.terms.split(/(?<=\.) /).join('\n'),{x:50,y:750,size:11,lineHeight:18});pandaPdf=await doc.save();return new Response(pandaPdf)}
      return Response.json({id:proposal.id,name:proposal.title,status:status==='accepted'?'document.completed':'document.draft',content_date_modified:'2026-10-26T12:00:00Z',recipients:[{id:'synthetic-locket-5',first_name:'Synthetic',last_name:'customer',email:'synthetic-locket-customer@example.test',has_completed:true,recipient_type:'signer'}],grand_total:{amount:'1200.00',currency:'USD'},pricing:{tables:[{name:'Products',currency:'USD',is_included_in_total:true,total:'1200.00',items:[{name:'Service',description:'Hosted seats',price:'500.00',qty:2,subtotal:'1000.00',options:{}},{name:'Support',description:'Annual support',price:'200.00',qty:1,subtotal:'200.00',options:{}}]}]}})
    }
    if(new URL(request.url).hostname==='api.stripe.com'){
      const path=new URL(request.url).pathname
      if(path.startsWith('/v1/prices/')){const first=path.endsWith('synthetic-locket-price-0');return Response.json({id:path.split('/').at(-1),active:true,currency:'usd',unit_amount:first?50000:20000,recurring:{interval:'month',interval_count:1,usage_type:'licensed'},billing_scheme:'per_unit'})}
      if(request.method==='POST'){assert.equal(path,'/v1/quotes');billCalls++;billingBody=new URLSearchParams(await request.text());return Response.json({id:'synthetic-locket-quote-1',status:'draft'})}
      if(path.endsWith('/line_items'))return Response.json({has_more:false,data:[{price:{id:'synthetic-locket-price-0',unit_amount:50000},quantity:2,currency:'usd',amount_subtotal:100000,amount_total:100000},{price:{id:'synthetic-locket-price-1',unit_amount:20000},quantity:1,currency:'usd',amount_subtotal:20000,amount_total:20000}]})
      assert.equal(path,'/v1/quotes/synthetic-locket-quote-1')
      return Response.json({id:'synthetic-locket-quote-1',status:variant==='stripe-uncertain'?'accepted':'draft',subscription:null,subscription_schedule:null,customer:billingBody.get('customer'),subscription_data:{effective_date:Number(billingBody.get('subscription_data[effective_date]'))},metadata:Object.fromEntries([...billingBody].filter(([key])=>key.startsWith('metadata[')).map(([key,value])=>[key.slice(9,-1),value]))})
    }
    if(new URL(request.url).hostname==='platter.example.test'){assert.equal(new URL(request.url).pathname,'/api/platter/agent/context');return Response.json({proposals:[{...proposal,status}]})}
    if(request.method==='GET'){assert.equal(new URL(request.url).pathname,'/api/nectar/proposals/synthetic-locket-pending-1');return Response.json({id:'synthetic-locket-pending-1',status:'pending'})}
    assert.equal(new URL(request.url).pathname,'/api/nectar/proposal.create');billCalls++;billingBody=await request.json();assert.equal(billingBody.kind,'amendment');assert.equal(billingBody.payload.setup,true);return Response.json({id:'synthetic-locket-pending-1',kind:'amendment',impact:{}})
  }});t.after(()=>h.close())
  const requester=await h.invite('synthetic-locket-requester@example.test','requester')
  const input={proposalId:proposal.id,consent:true,...(panda?{provider:'pandadoc',customerName:'Synthetic customer',completedRecipientIds:['synthetic-locket-5']}:{ }),...(foreign?{usdRate:'1.25'}:{})}
  await requester.command('proposal.import',input,{error:'FORBIDDEN'})
  await h.owner.command('proposal.import',input,{error:'NOT_ACCEPTED'})
  status='accepted'
  if(rich){
    if(foreign) await h.owner.command('proposal.import',{...input,usdRate:undefined},{error:'INVALID'})
    proposal.acceptance.totalCents++
    await h.owner.command('proposal.import',input,{error:'PROPOSAL_PRICING'})
    proposal.acceptance.totalCents--
    proposal.acceptance.selection.items.push({...proposal.acceptance.selection.items[0]})
    await h.owner.command('proposal.import',input,{error:'PROPOSAL_PRICING'})
    proposal.acceptance.selection.items.pop()
  }
  const imported=await h.owner.command('proposal.import',input),id=imported.id
  let s=await h.owner.state(),a=s.agreements.find(a=>a.id===id)
  assert.equal(a.type,'customer');assert.equal(a.status,'draft');assert.equal(a.value_cents,expectedTotal)
  const importedText=s.versions.find(v=>v.id===a.current_version_id).text
  assert.match(importedText,rich?new RegExp(`1.5 x ${proposal.currency} 500.00; net ${proposal.currency} 607.50`):/Hosted seats: 2 x USD 500.00/)
  assert.doesNotMatch(importedText,/Not selected/)
  if(rich) assert.match(importedText,/Premium backup/)
  if(foreign){assert.equal(a.currency,'GBP');assert.equal(a.original_cents,105750);assert.equal(a.usd_rate,'1.25')}
  const source=JSON.parse(s.proposalSources.find(r=>r.agreement_id===id).snapshot)
  if(panda){assert.equal(source.provider,'pandadoc');assert.deepEqual(await download(h.owner,source.originalArtifactId),Buffer.from(pandaPdf));assert.equal(source.rawProviderDetail.status,'document.completed')}
  assert.equal(source.lineItems.length,rich?3:2);assert.equal(source.totalCents,expectedTotal);assert.equal(source.lineItems.reduce((n,line)=>n+line.quantity*line.unitCents,0),expectedTotal)
  await h.owner.command('proposal.import',input,{error:'DUPLICATE_PROPOSAL'})
  await h.owner.command('billing.proposal.prepare',{agreementId:id,version:a.version,consent:true},{error:'NOT_EXECUTED'})
  for(const requirement of s.requirements.filter(r=>r.agreement_id===id)) await h.owner.command('requirement.attach',{agreementId:id,requirementId:requirement.id,file:file('statement.pdf',pdf('synthetic-locket-1 scope'))})
  a=await find(h.owner,id)
  await h.owner.command('agreement.submit',{agreementId:id,version:a.version});a=await find(h.owner,id)
  await h.owner.command('approval.decide',{agreementId:id,version:a.version,versionId:a.current_version_id,kind:'commercial',decision:'approved'});a=await find(h.owner,id)
  const pkg=await h.owner.command('package.prepare',{agreementId:id,version:a.version,provider:'docusign',recipients:[{name:'Synthetic signer',email:'synthetic-locket-signer@example.test',action:'sign'}]});a=await find(h.owner,id)
  await h.owner.command('package.sent',{agreementId:id,version:a.version,packageId:pkg.packageId,envelopeId:'synthetic-locket-envelope-1'});a=await find(h.owner,id)
  let signed=await download(h.owner,pkg.pdfArtifactId)
  if(variant==='mismatch-accepted')signed=pdf('The signed terms differ from the approved pricing.')
  if(variant==='unreadable'){const {PDFDocument}=await import('pdf-lib');const blank=await PDFDocument.create();blank.addPage();signed=await blank.save()}
  const execution=await h.owner.command('execution.record',{agreementId:id,version:a.version,envelopeId:'synthetic-locket-envelope-1',executedOn:'2026-10-26',documentConfirmed:true,signers:[{name:'Synthetic signer',email:'synthetic-locket-signer@example.test'}],signed:file('signed.pdf',signed),certificate:file('certificate.pdf',pdf('synthetic-locket-1 certificate'))})
  if(['unreadable','mismatch-accepted'].includes(variant)){
    assert.equal(execution.status,'needs_review');a=await find(h.owner,id)
    await h.owner.command('execution.resolve',{agreementId:id,version:a.version,executionId:execution.executionId,reason:'Owner reviewed the supplied signed document manually.'})
    a=await find(h.owner,id);assert.equal(a.status,'executed')
    await h.owner.command('billing.proposal.prepare',{agreementId:id,version:a.version,consent:true},{error:'BILLING_SOURCE'})
    assert.equal(billCalls,0,'manual execution acceptance must not authorize automatic billing');continue
  }
  assert.equal(execution.status,'reconciled')
  a=await find(h.owner,id)
  await h.owner.command('billing.proposal.prepare',{agreementId:id,version:a.version,consent:true},{error:'BILLING_TERMS'})
  for(const [key,value] of [['effective_date','2026-11-01'],['initial_term_months','12'],['renewal_type','auto_renew'],['renewal_term_months','12'],['notice_days','30']]){
    const term=await h.owner.command('term.propose',{agreementId:id,key,value,citation:{quote:proposal.terms}})
    await h.owner.command('term.decide',{agreementId:id,termId:term.id,decision:'confirm'})
  }
  a=await find(h.owner,id)
  const sourceText=(await h.owner.state()).versions.find(v=>v.id===a.current_version_id).text
  const nectarMapping={customerId:'synthetic-locket-customer-1',customerQuote:'Customer: Synthetic customer',subscriptionQuote:proposal.terms,renewalQuote:proposal.terms,renewalUpliftPercent:'0',lines:source.lineItems.map(line=>({quote:sourceText.split('\n').find(text=>text.includes(line.description)),intervalUnit:'month',intervalCount:1,billingTiming:stripe?'advance':'arrears',taxable:false,...(stripe?{stripePriceId:`synthetic-locket-price-${source.lineItems.indexOf(line)}`}:{})}))}
  await h.owner.command('billing.proposal.prepare',{agreementId:id,version:a.version,consent:true,nectarMapping:{...nectarMapping,customerQuote:'Not in the executed document'}},{error:'BILLING_QUOTE'})
  await h.owner.command('billing.proposal.prepare',{agreementId:id,version:a.version,consent:true,nectarMapping:{...nectarMapping,lines:nectarMapping.lines.map(line=>({...line,taxable:undefined}))}},{error:'BILLING_MAPPING'})
  if(rich){
    const differing=await h.owner.command('term.propose',{agreementId:id,key:'renewal_term_months',value:'6',citation:{quote:proposal.terms}})
    await h.owner.command('term.decide',{agreementId:id,termId:differing.id,decision:'confirm'})
    a=await find(h.owner,id)
    await h.owner.command('billing.proposal.prepare',{agreementId:id,version:a.version,consent:true,nectarMapping},{error:'BILLING_MAPPING'})
    const matching=await h.owner.command('term.propose',{agreementId:id,key:'renewal_term_months',value:'12',citation:{quote:proposal.terms}})
    await h.owner.command('term.decide',{agreementId:id,termId:matching.id,decision:'confirm'})
    a=await find(h.owner,id)
  }
  const prepared=await h.owner.command('billing.proposal.prepare',{agreementId:id,version:a.version,consent:true,nectarMapping,...(stripe?{provider:'stripe'}:{})})
  assert.equal(billCalls,0,'preparation must not send or activate billing')
  await requester.command('billing.proposal.send',{agreementId:id,version:a.version,id:prepared.id,consent:true},{error:'FORBIDDEN'})
  const commandId=crypto.randomUUID()
  await h.owner.command('billing.proposal.send',{agreementId:id,version:a.version,id:prepared.id,consent:true},{commandId})
  await h.owner.command('billing.proposal.send',{agreementId:id,version:a.version,id:prepared.id,consent:true},{commandId})
  assert.equal(billCalls,1,'command retry must not send twice')
  if(stripe){
    assert.equal(billingBody.get('customer'),'synthetic-locket-customer-1');assert.equal(billingBody.get('subscription_data[effective_date]'),'1793491200')
    assert.equal(billingBody.get('line_items[0][price]'),'synthetic-locket-price-0');assert.equal(billingBody.get('line_items[0][quantity]'),'2')
    assert.equal(billingBody.get('line_items[1][price]'),'synthetic-locket-price-1');assert.equal(billingBody.get('line_items[1][quantity]'),'1')
    assert.equal(billingBody.get('metadata[locket_initial_months]'),'12');assert.equal(billingBody.get('metadata[locket_renewal]'),JSON.stringify({months:12,noticeDays:30,upliftPercent:'0'}))
    assert.equal((await h.owner.state()).billingProposals.find(r=>r.id===prepared.id).status,variant==='stripe-uncertain'?'uncertain':'pending')
    await h.owner.command('billing.proposal.send',{agreementId:id,version:a.version,id:prepared.id,consent:true},{error:'STALE'});assert.equal(billCalls,1);continue
  }
  assert.equal(billingBody.payload.subscription.start_date,'2026-11-01');assert.equal(billingBody.payload.subscription.term_months,12)
  assert.equal(billingBody.payload.subscription.renewal.auto_renew,true);assert.equal(billingBody.payload.subscription.renewal.months,12)
  assert.equal(billingBody.payload.items.length,rich?3:2);assert.equal(billingBody.payload.catalog.reduce((n,line,i)=>n+Number(line.unit_amount)*100*billingBody.payload.items[i].quantity,0),expectedTotal)
  assert.equal((await h.owner.state()).billingProposals.find(r=>r.id===prepared.id).status,'pending')
  }
})
