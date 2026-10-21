import { randomUUID } from 'node:crypto'
import { file, pdf } from './files.mjs'

// The clause's three conflicting passages, entered through the normal import,
// citation confirmation and family-link doors. No records are injected into D1.
export async function familyConflictFixture(client) {
  const tag = randomUUID().slice(0, 8)
  const create = async (title, days, extra = {}) => {
    const quote = `Agreement ${tag}. Notice requires ${days} days. Payment is due in 30 days. Effective March 1, 2022. Term ends February 28, 2023. Renews every 12 months.`
    const a = await client.command('legacy.import', { title, type: 'other', party: { name: 'Northwind Services', kind: 'supplier' }, sourceSystem: 'Legal archive', sourceId: `${tag}-${days}`, file: file(`${days}-days.pdf`, pdf(quote)), text: quote, ...extra })
    return { id: a.id, quote }
  }
  const confirm = async (a, key, value, quote = a.quote) => {
    const t = await client.command('term.propose', { agreementId: a.id, key, value, citation: { quote, page: 1 } })
    await client.command('term.decide', { agreementId: a.id, termId: t.id, decision: 'confirm' })
    return t.id
  }
  const master = await create('Northwind MSA', 60)
  const amendment = await create('Northwind notice amendment', 90)
  const order = await create('Northwind hosting order', 30)
  for (const a of [master, amendment, order]) {
    a.noticeTermId = await confirm(a, 'notice_days', a === master ? '60' : a === amendment ? '90' : '30')
    await confirm(a, 'payment_terms', 'Net 30', 'Payment is due in 30 days.')
  }
  for (const [key, value, quote] of [
    ['effective_date', '2022-03-01', 'Effective March 1, 2022.'],
    ['end_date', '2023-02-28', 'Term ends February 28, 2023.'],
    ['auto_renew', 'yes', 'Renews every 12 months.'],
    ['renewal_term_months', '12', 'Renews every 12 months.'],
  ]) await confirm(master, key, value, quote)
  for (const [a, relation] of [[amendment, 'amends'], [order, 'order_under']]) {
    const row = (await client.state()).agreements.find(r => r.id === a.id)
    await client.command('family.link', { agreementId: a.id, version: row.version, parentId: master.id, relation })
  }
  return { master, amendment, order, confirm, create }
}
