import { file, pdf } from './files.mjs'

export async function familyFixture(owner) {
  const create = async (title, startDate) => (await owner.command('request.create', { title, startDate, type: 'other', party: {name:'Northwind Technology Inc.',kind:'supplier'} })).id
  const master = await create('Northwind master services agreement', '2026-01-01')
  const first = await create('Northwind hosting order', '2026-02-01')
  const second = await create('Northwind support order', '2026-03-01')
  const amendment = (await owner.command('legacy.import', { title:'Northwind term extension', type:'other', party:{name:'Northwind Technology Inc.',kind:'supplier'}, sourceSystem:'Legal archive',sourceId:'extension-2026',startDate:'2026-04-01', file:file('term-extension.pdf',pdf('Term ends December 31, 2028.')) })).id
  const term = await owner.command('term.propose', {agreementId:amendment,key:'end_date',value:'2028-12-31',citation:{quote:'Term ends December 31, 2028.',page:1}})
  await owner.command('term.decide', {agreementId:amendment,termId:term.id,decision:'confirm'})
  // Keep the realistic document date independent of creation/command times.
  return {master,first,second,amendment,termId:term.id}
}
