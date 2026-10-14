// The DocuSign archive move-in kit on Base's import-kit: dry run, journalled
// apply with exact original bytes, duplicate detection, undo, and refusal to
// undo once imported agreements are in use.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { installation } from './harness.mjs'
import { file, pdf } from './files.mjs'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const MSA = '3F2A9C10-5B7E-4D21-9A6B-1C2D3E4F5A60', NDA = '7C1B2D3E-8F90-4A1B-BC2D-3E4F5A6B7C80'

async function archive() {
  const manifest = await readFile('tests/fixtures/docusign-archive/envelopes.csv')
  const files = {
    [`${MSA}/Harbour Supplies MSA.pdf`]: pdf('Harbour Supplies master supply agreement, signed', 3),
    [`${MSA}/Summary.pdf`]: pdf('Certificate of Completion envelope ' + MSA),
    [`${NDA}/Ridgeway NDA.pdf`]: pdf('Ridgeway mutual NDA, signed'),
    ['Unlisted envelope/Notes.pdf']: pdf('Not in the report'),
  }
  return {
    payload: { kit: 'docusign-archive', label: 'DocuSign archive to 30 Sep 2026', dateFormat: 'dmy', manifest: file('envelopes.csv', manifest), files: Object.entries(files).map(([path, bytes]) => ({ path, base64: bytes.toString('base64') })) },
    files,
  }
}

test('DocuSign archive move-in: dry run, apply with originals, duplicates, undo and dependency refusal', async t => {
  const h = await installation(); t.after(() => h.close())
  const counsel = await h.invite('counsel@example.test', 'counsel')
  const { payload, files } = await archive()
  await counsel.command('import.preview', payload, { error: 'FORBIDDEN' })
  const dry = await h.owner.command('import.preview', payload)
  assert.deepEqual(dry.counts, { rows: 5, import: 2, skip: 1, duplicate: 1, missing: 1, withoutCertificate: 1, orphanFiles: 1, bytes: Object.values(files).reduce((n, b) => n + b.length, 0) })
  let s = await h.owner.state()
  assert.equal(s.agreements.length, 0, 'a dry run writes no agreements')
  const batch = s.imports.find(b => b.id === dry.batchId)
  const rows = JSON.parse(batch.preview).rows
  assert.equal(rows.find(r => r.envelopeId === NDA).counterparty, 'ridgeway-fixture.example')
  assert.match(rows.find(r => r.status === 'Sent').notes.join(' '), /Only completed envelopes/)

  await h.owner.command('import.apply', { batchId: batch.id, version: batch.version, fingerprint: 'not-the-reviewed-one' }, { error: 'FINGERPRINT' })
  await h.owner.command('import.apply', { batchId: batch.id, version: batch.version, fingerprint: batch.fingerprint })
  s = await h.owner.state()
  assert.equal(s.agreements.length, 2)
  const msa = s.agreements.find(a => a.title.includes('Harbour'))
  assert.equal(msa.status, 'imported')
  assert.equal(msa.type, 'supplier')
  assert.equal(s.parties.find(p => p.id === msa.party_id).name, 'Harbour Supplies Pty Ltd')
  const execution = s.executions.find(e => e.agreement_id === msa.id)
  assert.equal(execution.imported, 1)
  assert.equal(execution.envelope_id, MSA)
  assert.equal(execution.executed_on, '2025-03-14')
  assert.equal(execution.status, 'reconciled')
  for (const [role, path] of [['signed', `${MSA}/Harbour Supplies MSA.pdf`], ['certificate', `${MSA}/Summary.pdf`]]) {
    const f = s.artifacts.find(x => x.agreement_id === msa.id && x.role === role)
    assert.equal(f.sha256, sha(files[path]))
    assert.equal(JSON.parse(f.provenance).path, path)
    assert.deepEqual(Buffer.from(await (await h.owner.request(`/api/locket/files/${f.id}`)).arrayBuffer()), files[path])
  }
  const nda = s.agreements.find(a => a.title.includes('Ridgeway'))
  assert.equal(s.executions.find(e => e.agreement_id === nda.id).status, 'needs_review')
  const imported = s.terms.filter(x => x.agreement_id === msa.id)
  assert.deepEqual(imported.map(x => [x.key, x.value, x.status]).sort(), [['end_date', '2027-03-31', 'proposed'], ['notice_days', '60', 'proposed']])
  assert.equal(s.renewals.length, 0, 'imported dates drive nothing until confirmed')

  // The same archive again finds both envelopes already held.
  const again = await h.owner.command('import.preview', { ...payload, label: 'Same archive again' })
  assert.equal(again.counts.import, 0)
  assert.equal(again.counts.duplicate, 3)
  // Applying a later batch that repeats held envelopes journals them and changes nothing.
  const repeat = (await h.owner.state()).imports.find(b => b.id === again.batchId)
  await h.owner.command('import.apply', { batchId: repeat.id, version: repeat.version, fingerprint: repeat.fingerprint })
  assert.equal((await h.owner.state()).agreements.length, 2)

  // An unused batch undoes completely; the journal and its originals stay.
  s = await h.owner.state()
  let applied = s.imports.find(b => b.id === dry.batchId)
  await h.owner.command('import.undo', { batchId: applied.id, version: applied.version, reason: 'Wrong date range' })
  s = await h.owner.state()
  assert.equal(s.agreements.length, 0)
  assert.equal(s.artifacts.length, 0)
  assert.equal(s.imports.find(b => b.id === dry.batchId).status, 'undone')
  const originals = await h.db.prepare('SELECT COUNT(*) AS n FROM ik_originals WHERE job_id=?').bind(JSON.parse(applied.preview).jobId).first()
  assert.ok(originals.n >= 5, 'the import journal keeps the report and every supplied file')

  // Re-import, correct the imported renewal date against the signed PDF: undo is now refused.
  const second = await h.owner.command('import.preview', { ...payload, label: 'Re-run' })
  s = await h.owner.state()
  const rerun = s.imports.find(b => b.id === second.batchId)
  await h.owner.command('import.apply', { batchId: rerun.id, version: rerun.version, fingerprint: rerun.fingerprint })
  s = await h.owner.state()
  const msa2 = s.agreements.find(a => a.title.includes('Harbour'))
  const wrong = s.terms.find(x => x.agreement_id === msa2.id && x.key === 'end_date')
  const days = s.terms.find(x => x.agreement_id === msa2.id && x.key === 'notice_days')
  await counsel.command('term.decide', { agreementId: msa2.id, termId: days.id, decision: 'confirm' })
  await counsel.command('term.decide', { agreementId: msa2.id, termId: wrong.id, decision: 'reject', reason: 'Signed clause 14.1 says 30 April 2027' })
  const right = await counsel.command('term.propose', { agreementId: msa2.id, key: 'end_date', value: '2027-04-30', reason: 'Imported date was wrong', citation: { quote: 'This agreement ends on 30 April 2027.', page: 2 } })
  await counsel.command('term.decide', { agreementId: msa2.id, termId: right.id, decision: 'confirm' })
  s = await h.owner.state()
  assert.deepEqual(s.terms.filter(x => x.agreement_id === msa2.id && x.key === 'end_date').map(x => [x.value, x.status]).sort(), [['2027-03-31', 'rejected'], ['2027-04-30', 'confirmed']])
  assert.equal(s.renewals.find(r => r.agreement_id === msa2.id).deadline_date, '2027-03-01')
  applied = s.imports.find(b => b.id === rerun.id)
  const refused = await h.owner.command('import.undo', { batchId: applied.id, version: applied.version, reason: 'Try again' }, { error: 'IMPORT_DEPENDENCY' })
  assert.equal(refused.error.details.used[0].reference, msa2.reference)
  s = await h.owner.state()
  assert.equal(s.agreements.length, 2)
  assert.equal(s.imports.find(b => b.id === rerun.id).status, 'applied')
})

test('undo is refused, and changes nothing, once a new request names an imported counterparty', async t => {
  const h = await installation(); t.after(() => h.close())
  const requester = await h.invite('requester@example.test', 'requester')
  const { payload } = await archive()
  const dry = await h.owner.command('import.preview', payload)
  let batch = (await h.owner.state()).imports.find(b => b.id === dry.batchId)
  await h.owner.command('import.apply', { batchId: batch.id, version: batch.version, fingerprint: batch.fingerprint })
  const before = await h.owner.state()
  const harbour = before.parties.find(p => p.name === 'Harbour Supplies Pty Ltd')
  const own = await requester.command('request.create', { title: 'Harbour cleaning add-on', type: 'supplier', partyId: harbour.id })
  batch = (await h.owner.state()).imports.find(b => b.id === dry.batchId)
  for (const attempt of [1, 2]) {
    const refused = await h.owner.command('import.undo', { batchId: batch.id, version: batch.version, reason: `Attempt ${attempt}` }, { error: 'IMPORT_DEPENDENCY' })
    assert.equal(refused.error.details.used[0].reference, own.reference)
  }
  const after = await h.owner.state()
  assert.equal(after.imports.find(b => b.id === dry.batchId).status, 'applied')
  assert.deepEqual(after.agreements.filter(a => a.status === 'imported').map(a => a.id).sort(), before.agreements.map(a => a.id).sort())
  assert.equal(after.artifacts.length, before.artifacts.length)
})
