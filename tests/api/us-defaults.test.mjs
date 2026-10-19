import assert from 'node:assert/strict'
import test from 'node:test'
import { installation } from './harness.mjs'
import { team } from './setup.mjs'
import { file, pdf } from './files.mjs'

const labels = (s, id) => s.requirements.filter(r => r.agreement_id === id).map(r => r.label).sort()
const quote = 'This agreement ends on December 26, 2026; either party may give 30 days notice.'
async function confirm(client, agreementId, terms) {
  for (const [key, value] of terms) {
    const t = await client.command('term.propose', { agreementId, key, value, citation: { quote } })
    await client.command('term.decide', { agreementId, termId: t.id, decision: 'confirm' })
  }
}

test('US-001 installation US zone, USD with recorded-rate other currencies, EINs, US required attachments and Thanksgiving business-day rolling', async t => {
  const h = await installation(); t.after(() => h.close())
  const people = await team(h)

  // A fresh installation: USD, Eastern until the owner chooses, deadlines on their calendar date.
  let s = await people.requester.state()
  assert.deepEqual(s.settings, { timezone: 'America/New_York', rollNoticeDeadlines: false, version: 0 })
  await people.counsel.command('installation.settings', { timezone: 'America/Los_Angeles', rollNoticeDeadlines: true, version: 0 }, { error: 'FORBIDDEN' })
  await h.owner.command('installation.settings', { timezone: 'Europe/London', rollNoticeDeadlines: false, version: 0 }, { error: 'INVALID' })
  await h.owner.command('installation.settings', { timezone: 'America/Los_Angeles', rollNoticeDeadlines: false, version: 0 })
  await h.owner.command('installation.settings', { timezone: 'America/Chicago', rollNoticeDeadlines: false, version: 0 }, { error: 'STALE' })
  s = await people.requester.state()
  assert.deepEqual(s.settings, { timezone: 'America/Los_Angeles', rollNoticeDeadlines: false, version: 1 })

  // New requests inherit the installation's zone and USD; one may name another zone.
  const supplier = await people.requester.command('request.create', { title: 'Courier services', type: 'supplier', party: { name: 'Fast Couriers', kind: 'supplier', taxIdKind: 'ein', taxId: '12-3456789' }, value: '48000' })
  const customer = await people.requester.command('request.create', { title: 'Cleaning order', type: 'customer', party: { name: 'Clean Co', kind: 'customer' }, timezone: 'America/Denver' })
  const nda = await people.requester.command('request.create', { title: 'Mutual NDA', type: 'nda', party: { name: 'Northwind', kind: 'partner', taxIdKind: 'foreign', taxId: 'GB123456789' } })
  const amendment = await people.requester.command('request.create', { title: 'Courier variation', type: 'amendment', partyId: (await people.requester.state()).parties.find(p => p.name === 'Fast Couriers').id, parentId: supplier.id })
  await people.requester.command('request.create', { title: 'Bad EIN', type: 'nda', party: { name: 'Bad Tax', kind: 'supplier', taxIdKind: 'ein', taxId: '123456789' } }, { error: 'INVALID' })
  s = await people.requester.state()
  const row = id => s.agreements.find(a => a.id === id)
  assert.deepEqual([row(supplier.id).timezone, row(supplier.id).currency, row(supplier.id).value_cents, row(supplier.id).original_cents], ['America/Los_Angeles', 'USD', 4800000, null])
  assert.equal(row(customer.id).timezone, 'America/Denver')
  assert.deepEqual(s.parties.map(p => [p.name, p.tax_id_kind, p.tax_id]), [['Clean Co', null, null], ['Fast Couriers', 'ein', '12-3456789'], ['Northwind', 'foreign', 'GB123456789']])

  // US required attachments: supplier COI and W-9, customer SOW or order form, amendment the signed parent, NDA none.
  assert.deepEqual(labels(s, supplier.id), ['Certificate of insurance', 'Form W-9'])
  assert.deepEqual(labels(s, customer.id), ['Statement of work or order form'])
  assert.deepEqual(labels(s, amendment.id), ['Signed parent agreement'])
  assert.deepEqual(labels(s, nda.id), [])
  const v = await people.requester.command('version.upload', { agreementId: supplier.id, version: row(supplier.id).version, kind: 'upload', label: 'Draft', file: file('draft.pdf', pdf('Courier draft')), text: 'Courier draft' })
  assert.ok(v.versionId)
  s = await people.requester.state()
  const coi = s.requirements.find(r => r.agreement_id === supplier.id && r.label === 'Certificate of insurance')
  await people.requester.command('requirement.attach', { agreementId: supplier.id, requirementId: coi.id, file: file('coi.pdf', pdf('Certificate of insurance')) })
  const blocked = await people.requester.command('agreement.submit', { agreementId: supplier.id, version: (await people.requester.state()).agreements.find(a => a.id === supplier.id).version }, { error: 'MISSING_ATTACHMENTS' })
  assert.deepEqual(blocked.error.details.missing, ['Form W-9'])

  // Another currency keeps its original amount; the USD equivalent comes from the rate a person records.
  await people.requester.command('request.create', { title: 'London services', type: 'nda', party: { name: 'Thames Ltd', kind: 'supplier' }, value: '40000', currency: 'GBP' }, { error: 'INVALID' })
  await people.requester.command('request.create', { title: 'London services', type: 'nda', party: { name: 'Thames Ltd', kind: 'supplier' }, value: '40000', currency: 'GBP', usdRate: '0' }, { error: 'INVALID' })
  const gbp = await people.requester.command('request.create', { title: 'London services', type: 'nda', party: { name: 'Thames Ltd', kind: 'supplier' }, value: '40000', currency: 'gbp', usdRate: '1.2705' })
  s = await people.requester.state()
  let london = row(gbp.id)
  assert.deepEqual([london.currency, london.original_cents, london.usd_rate, london.value_cents, london.rate_recorded_by], ['GBP', 4000000, '1.2705', 5082000, people.requester.id])
  assert.match(s.audit.find(a => a.agreement_id === gbp.id && a.action === 'request.create').summary, /40000\.00 GBP = \$50820\.00 USD at 1\.2705 USD per GBP/)
  // Half a cent rounds up: 0.01 GBP at 1.25 is 1.25 cents, 0.03 GBP at 1.5 is 4.5 cents -> 5.
  await people.requester.command('request.update', { agreementId: gbp.id, version: london.version, value: '0.03', usdRate: '1.5' })
  london = (await people.requester.state()).agreements.find(a => a.id === gbp.id)
  assert.deepEqual([london.original_cents, london.value_cents, london.usd_rate], [3, 5, '1.5'])
  // The same rate kept on a later edit keeps who recorded it.
  await people.counsel.command('request.update', { agreementId: gbp.id, version: london.version, value: '40000' })
  london = (await people.counsel.state()).agreements.find(a => a.id === gbp.id)
  assert.deepEqual([london.currency, london.original_cents, london.value_cents, london.rate_recorded_by], ['GBP', 4000000, 6000000, people.requester.id])
  // Rules, totals and filters read the USD equivalent.
  const repo = await (await people.requester.request('/api/locket/repository?definition=' + encodeURIComponent(JSON.stringify({ query: '', filters: [{ field: 'value', operator: 'gte', value: '59000' }], sort: { field: 'title', direction: 'asc' }, columns: ['title', 'value'] })))).json()
  assert.deepEqual(repo.rows.map(r => r.values.title), ['London services'])

  // Thanksgiving 2026 is Thursday November 26: a notice deadline there rolls back to Wednesday with the option on.
  const legacy = await h.owner.command('legacy.import', { title: 'Holiday supply', type: 'other', party: { name: 'Holiday Goods', kind: 'supplier' }, sourceSystem: 'Shared drive', sourceId: 'contracts/holiday.pdf', signed: true, text: quote, file: file('holiday.pdf', pdf(quote)) })
  assert.equal((await h.owner.state()).agreements.find(a => a.id === legacy.id).timezone, 'America/Los_Angeles')
  await confirm(h.owner, legacy.id, [['end_date', '2026-12-26'], ['notice_days', '30'], ['auto_renew', 'no']])
  const renewal = async () => (await h.owner.state()).renewals.find(r => r.agreement_id === legacy.id)
  assert.equal((await renewal()).deadline_date, '2026-11-26')
  const turnedOn = await h.owner.command('installation.settings', { timezone: 'America/Los_Angeles', rollNoticeDeadlines: true, version: 1 })
  assert.equal(turnedOn.moved, 1)
  let r = await renewal()
  assert.equal(r.deadline_date, '2026-11-25')
  assert.equal(r.deadline_at, Date.parse('2026-11-26T07:59:59Z'))
  s = await h.owner.state()
  assert.equal(s.portfolio.lifecycle[legacy.id].deadline.date, '2026-11-25')
  assert.match(s.audit.find(a => a.action === 'installation.settings' && a.summary.includes('previous US business day')).summary, /1 open notice deadline re-dated/)
  // Turned off, the deadline returns to its calendar date; a deadline confirmed with the option on rolls when it is set.
  await h.owner.command('installation.settings', { timezone: 'America/Los_Angeles', rollNoticeDeadlines: false, version: 2 })
  assert.equal((await renewal()).deadline_date, '2026-11-26')
  await h.owner.command('installation.settings', { timezone: 'America/Los_Angeles', rollNoticeDeadlines: true, version: 3 })
  // Weekend deadlines roll to Friday (Saturday 28 and Sunday 29 -> Friday 27); a business day stays (Monday 30).
  for (const [days, date] of [['28', '2026-11-27'], ['27', '2026-11-27'], ['26', '2026-11-30']]) {
    await confirm(h.owner, legacy.id, [['notice_days', days]])
    assert.equal((await renewal()).deadline_date, date)
  }
})
