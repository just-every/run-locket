import { file, docx } from './files.mjs'
export const searchText = '1. Services\nNorthwind supplies managed hosting.\n2. Limitation of liability\nThe limitation of liability is $200,000.\n3. Commercial terms\nAgreed terms.'
export async function searchFixture(owner, tag = 'search') {
  const ids = {}
  for (const [key, type, amount, end, auto, restricted] of [
    ['current', 'supplier', '250000', '2023-02-28', 'yes', false],
    ['expired', 'supplier', '250000', '2023-02-28', 'no', false],
    ['small', 'supplier', '99999.99', '2027-02-28', 'no', false],
    ['customer', 'customer', '250000', '2027-02-28', 'no', false],
    ['hidden', 'supplier', '850000', '2023-02-28', 'yes', true],
  ]) {
    const a = await owner.command('legacy.import', { title: `Northwind ${key} ${tag}`, type, party: { name: `Northwind ${key} LLC ${tag}`, kind: type }, value: amount, restricted, sourceSystem: 'Legal archive', sourceId: `${key}-${tag}`, file: file(`${key}.docx`, docx((searchText + `\nArchive ${key} ${tag}`).split('\n'))), text: searchText, signed: true })
    ids[key] = a.id
    for (const [key, value] of Object.entries({ effective_date: '2022-03-01', end_date: end, auto_renew: auto, renewal_term_months: '12', notice_days: '60', governing_law: 'New York', payment_terms: 'Net 30' })) {
      const term = await owner.command('term.propose', { agreementId: a.id, key, value, citation: { quote: 'Agreed terms.' } })
      await owner.command('term.decide', { agreementId: a.id, termId: term.id, decision: 'confirm' })
    }
  }
  return ids
}
export const searchDefinition = { query: 'limitation of liability', filters: [
  { field: 'type', operator: 'eq', value: 'supplier' },
  { field: 'value', operator: 'gte', value: '100000' },
  { field: 'current_term_end', operator: 'gte', value: '2026-10-17' },
  { field: 'current_term_end', operator: 'lte', value: '2027-04-15' },
], sort: { field: 'title', direction: 'asc' }, columns: ['title', 'value', 'current_term_end', 'lifecycle'] }
