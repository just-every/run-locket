// The acceptance archive enters through the real import and human-review doors.
import { file, pdf } from './setup.mjs'
import { randomUUID } from 'node:crypto'
export const bulkClock = Date.parse('2026-10-17T12:00:00Z')
export const bulkTerms = { effective_date: '2022-03-01', end_date: '2023-02-28', auto_renew: 'yes', renewal_term_months: '12', notice_days: '60', governing_law: 'New York', payment_terms: 'Net 30' }
export async function bulkAgreement(owner, tag, { terms = bulkTerms, restricted = false, timezone = 'America/New_York' } = {}) {
  const a = await owner.command('legacy.import', { title: `Archive ${tag}`, type: 'supplier', party: { name: `Supplier ${tag}`, kind: 'supplier' }, sourceSystem: 'Historical archive', sourceId: tag, restricted, timezone, signed: true, file: file(`${tag}.pdf`, pdf(`Agreed terms. ${tag}`)), text: `Agreed terms. ${tag}` })
  if (Object.keys(terms).length) {
    const p = await owner.command('proposal.prepare', { kind: 'terms', payload: { agreementId: a.id, terms: Object.entries(terms).map(([key, value]) => ({ key, value, citation: { quote: 'Agreed terms.', page: 1 } })) }, evidence: [`Signed archive ${tag}, page 1`], assumptions: '' })
    await owner.command('proposal.decide', { proposalId: p.id, decision: 'approve' })
  }
  return a.id
}
export async function bulkFixture(owner, tag = 'API') {
  const files = [], manifest = ['Envelope ID,Subject,Status,Completed On,Counterparty,Agreement Type,Recipient Name,Recipient Email']
  for (let i = 0; i < 40; i++) {
    const label = `${tag}-${String(i + 1).padStart(2, '0')}`, envelope = randomUUID()
    manifest.push(`${envelope},Archive ${label},Completed,2022-03-01,Supplier ${label},Supplier,Jordan Counsel,jordan@supplier.example`)
    for (const [filename, body] of [['Agreement.pdf', `Agreed terms. ${label}`], ['Summary.pdf', `Certificate ${envelope}`]]) files.push({path:`${envelope}/${filename}`,base64:pdf(body).toString('base64')})
  }
  const dry = await owner.command('import.preview',{kit:'docusign-archive',label:`Renewal archive ${tag}`,dateFormat:'iso',manifest:file('envelopes.csv',Buffer.from(manifest.join('\r\n'))),files})
  const batch = (await owner.state()).imports.find(b=>b.id===dry.batchId)
  let checkpoint=0
  // Follow the public resumable import door when its request budget is reached.
  for(let attempt=0;attempt<40;attempt++){
    const response=await owner.request('/api/locket/commands',{method:'POST',body:{commandId:randomUUID(),type:'import.apply',payload:{batchId:batch.id,version:batch.version,fingerprint:batch.fingerprint}}})
    const result=await response.json()
    if(result.ok)break
    if(result.error?.code!=='IMPORT_INCOMPLETE')throw Error(JSON.stringify(result))
    const progress=(await owner.state()).agreements.filter(a=>a.title.startsWith(`Archive ${tag}-`)).length
    if(progress<=checkpoint)throw Error('Resumed import must advance its durable journal')
    checkpoint=progress
  }

  if ((await owner.state()).imports.find(b=>b.id===batch.id)?.status !== 'applied') throw Error('The reviewed archive must finish applying')
  const agreements = (await owner.state()).agreements.filter(a=>a.title.startsWith(`Archive ${tag}-`)).sort((a,b)=>a.title.localeCompare(b.title))
  if(agreements.length!==40) throw Error('The archive must import exactly 40 agreements')
  const ids = [], old = [], missing = []
  for (let i = 0; i < agreements.length; i++) {
    const id = agreements[i].id
    const terms = i < 20 ? bulkTerms : i < 34 ? { ...bulkTerms, effective_date: '2026-01-01', end_date: '2027-12-31', auto_renew: 'no' } : {}
    if(Object.keys(terms).length){
      const proposal=await owner.command('proposal.prepare',{kind:'terms',payload:{agreementId:id,terms:Object.entries(terms).map(([key,value])=>({key,value,citation:{quote:'Agreed terms.',page:1}}))},evidence:[`Signed archive ${agreements[i].title}, page 1`]})
      await owner.command('proposal.decide',{proposalId:proposal.id,decision:'approve'})
    }
    ids.push(id)
    if (i < 20) old.push(id)
    if (i >= 34) missing.push(id)
  }
  return { ids, old, missing, batchId:batch.id }
}
