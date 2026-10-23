import { file, pdf } from './setup.mjs'
async function confirmed(client, id, values) {
  for (const [key, value] of Object.entries(values)) {
    const p = await client.command('term.propose', { agreementId: id, key, value: String(value), citation: { quote: 'Agreed terms.', page: 1 } })
    await client.command('term.decide', { agreementId: id, termId: p.id, decision: 'confirm' })
  }
}
export async function portfolioFixture(owner, tag = 'API') {
  const ids = {}
  const defaults = { effective_date: '2022-03-01', end_date: '2023-02-28', auto_renew: 'yes', renewal_term_months: '12', notice_days: '60', governing_law: 'New York', payment_terms: 'Net 30' }
  for (const [key, type, value, terms, restricted] of [
    ['old', 'supplier', '100000.25', defaults, false],
    ['expired', 'customer', '8000', { ...defaults, auto_renew: 'no' }, false],
    ['soon', 'nda', '900.50', { ...defaults, effective_date: '2026-01-01', end_date: '2026-11-15', auto_renew: 'no', notice_days: '10' }, false],
    ['missing', 'other', null, {}, false],
    ['hidden', 'supplier', '777777', defaults, true],
    ['future', 'customer', '50', { ...defaults, effective_date: '2027-01-01', end_date: '2027-12-31', auto_renew: 'no' }, false],
  ]) {
    const a = await owner.command('legacy.import', { title: `${key} agreement ${tag}`, type, party: { name: `Counterparty ${key} ${tag}`, kind: type === 'supplier' ? 'supplier' : 'customer' }, ...(value === null ? {} : { value }), restricted, sourceSystem: 'Historical archive', sourceId: `${tag}-${key}`, file: file(`${key}.pdf`, pdf(`Agreed terms. ${key} ${tag}`)), text: 'Agreed terms.', signed: true })
    ids[key] = a.id
    await confirmed(owner, a.id, terms)
  }
  const own = (await owner.state()).actor.id
  for (const [description, due, confirm] of [['Insurance overdue', '2026-10-15', true], ['Report overdue', '2026-10-16', true], ['Future report', '2026-11-01', true], ['Unconfirmed duty', '2026-10-01', false]]) {
    const o = await owner.command('obligation.add', { agreementId: ids.old, description, ownerId: own, dueDate: due, recurrence: 'none', citation: { quote: 'Agreed terms.' } })
    if (confirm) await owner.command('obligation.update', { agreementId: ids.old, obligationId: o.id, action: 'confirm' })
  }
  return ids
}


/** Cited historic terms enter only through import, proposal and human approval. */
export async function renewalScenario(owner, overrides = {}, tag = crypto.randomUUID(), options = {}) {
  const quote = 'Agreed renewal terms and early termination clause.'
  const a = await owner.command('legacy.import', {title:options.title??`Supplier services ${tag.slice(0,8)}`,type:'supplier',party:{name:options.counterparty??`Supplier ${tag.slice(0,8)}`,kind:'supplier'},value:options.value??'1000',sourceSystem:'Authorized archive',sourceId:tag,file:file('signed.pdf',pdf(quote+' Reference '+tag)),text:quote,signed:true,timezone:'America/New_York'})
  const values={effective_date:'2022-03-01',end_date:'2023-02-28',renewal_type:'auto_renew',auto_renew:'yes',renewal_term_months:'12',renewals_allowed:'',notice_days:'60',governing_law:'New York',payment_terms:'Net 30',...overrides}
  const proposal=await owner.command('proposal.prepare',{kind:'terms',payload:{agreementId:a.id,terms:Object.entries(values).filter(([,value])=>value!==null).map(([key,value])=>({key,value,citation:{quote}}))},evidence:[quote]})
  await owner.command('proposal.decide',{proposalId:proposal.id,decision:'approve'})
  return {id:a.id,quote,async correction(key,value){const term=await owner.command('term.propose',{agreementId:a.id,key,value,citation:{quote}});await owner.command('term.decide',{agreementId:a.id,termId:term.id,decision:'confirm'})},async current(){return (await owner.state()).agreements.find(x=>x.id===a.id)}}
}
