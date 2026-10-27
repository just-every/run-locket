import assert from 'node:assert/strict'
import { file, pdf, library } from './setup.mjs'
import { configureModel } from './model-settings-fixture.mjs'
export const summaryExpected = [
 ['parties', 'Synthetic Customer and Synthetic Supplier', 'Synthetic Customer and Synthetic Supplier enter this MSA.'],
 ['entity', 'Synthetic Customer', 'Our entity is Synthetic Customer.'],
 ['our_duties', 'Pay invoices', 'Customer must pay invoices.'],
 ['their_duties', 'Provide support', 'Supplier must provide support.'],
 ['price', '12000 USD annually', 'The annual price is USD 12000.'],
 ['payment_terms', 'Net 30', 'Invoices are due in 30 days.'],
 ['initial_term_months', '12', 'The initial term is 12 months.'],
 ['renewal_term_months', '12', 'Renewal is automatic for 12 months.'],
 ['notice_days', '60', 'Nonrenewal requires 60 days notice.'],
 ['notice_deadline', 'Not established: effective and end dates are unconfirmed', 'Nonrenewal requires 60 days notice.'],
 ['termination', 'Termination for material breach', 'Either party may terminate for material breach.'],
 ['liability', 'Annual fees cap', 'Liability is capped at annual fees.'],
 ['insurance', '1000000 USD coverage', 'Supplier must maintain USD 1000000 insurance.'],
 ['exceptions', 'No accepted exceptions recorded', 'Exceptions require written approval.'],
]
export const summaryText = 'MASTER SERVICES AGREEMENT\n' + summaryExpected.map(x => x[2]).join('\n')
export function summaryFake(calls, mode = () => 'ok') {
 return async request => {
  assert.equal(request.url, 'https://api.openai.com/v1/chat/completions')
  const payload = await request.json(), input = JSON.parse(payload.messages[1].content)
  assert.equal(input.text, summaryText)
  assert.match(payload.messages[0].content, /^locket-summaries-v1:/)
  assert.equal(input.context.terms.find(t => t.key === 'notice_days' && t.status === 'confirmed').status, 'confirmed')
  calls.push(payload)
  const proposals = summaryExpected.map(([key,value,quote]) => ({key,value,quote,status:'confirmed'}))
  if (mode() === 'quote') proposals[7].quote = 'This renewal was invented.'
  if (mode() === 'omit') proposals.splice(7, 1)
  return Response.json({ choices: [{message:{content:JSON.stringify({proposals})}}], usage: {prompt_tokens:100, completion_tokens:100} })
 }
}
export async function summaryFixture(h) {
 await library(h, {counsel:h.owner})
 const created = await h.owner.command('legacy.import', { title:'Synthetic MSA', type:'supplier', party:{name:'Synthetic Supplier',kind:'supplier'}, sourceSystem:'Shared drive',sourceId:'synthetic-locket-summary-1',signed:true,text:summaryText,file:file('synthetic-locket-1.pdf',pdf(summaryText)) })
 const upload = async number => { const a = (await h.owner.state()).agreements.find(a => a.id === created.id); await h.owner.command('version.upload', {agreementId:a.id,version:a.version,kind:'upload',text:summaryText,file:file(`synthetic-locket-${number}.pdf`,pdf(summaryText))}) }
 const term = await h.owner.command('term.propose', {agreementId:created.id,key:'notice_days',value:'60',citation:{quote:summaryExpected[8][2]}})
 await h.owner.command('term.decide', {agreementId:created.id,termId:term.id,decision:'confirm'})
 await h.owner.command('term.propose', {agreementId:created.id,key:'renewal_term_months',value:'12',citation:{quote:summaryExpected[7][2]}})
 await configureModel(h)
 return {id:created.id,upload}
}
export async function summaryJourney(h, calls, setMode) {
 const f = await summaryFixture(h), request = {agreementId:f.id,task:'summaries',consent:true,simulated:true}
 await h.owner.command('model.run', {...request,simulated:false}, {error:'EVALUATION_REQUIRED'})
 assert.equal(calls.length,0)
 const output = await h.owner.command('model.run',request)
 assert.equal(output.status,'proposed')
 const read = async client => { const response = await client.request('/api/locket/summaries/'+output.id); assert.equal(response.status,200); return response.json() }
 const original = await read(h.owner), lines = JSON.parse(original.content).proposals
 assert.equal(original.version_number,1)
 assert.equal(original.stale,false)
 assert.deepEqual(lines.map(l => [l.key,l.value,l.quote]),summaryExpected)
 assert.equal(lines.length,14)
 for (const line of lines) assert.equal(summaryText.slice(line.start,line.end),line.quote)
 assert.equal(lines.find(l => l.key === 'renewal_term_months').status,'proposed')
 assert.equal(lines.find(l => l.key === 'notice_days').status,'confirmed')
 assert.equal((await h.owner.state()).renewals.length,0)
 const viewer = await h.invite('synthetic-locket-summary-viewer@example.test','viewer')
 assert.equal((await read(viewer)).content,original.content)
 const term = await h.owner.command('term.propose',{agreementId:f.id,key:'notice_days',value:'30',citation:{quote:summaryExpected[8][2]},reason:'Corrected by owner'})
 await h.owner.command('term.decide',{agreementId:f.id,termId:term.id,decision:'confirm'})
 assert.equal((await read(h.owner)).stale,true)
 assert.equal((await read(h.owner)).content,original.content)
 await h.owner.command('model.accept',{outputId:output.id},{error:'STALE'})
 for (const mode of ['quote','omit']) {
  setMode(mode)
  const bad = await h.owner.command('model.run',request)
  assert.equal(bad.status,'uncertain',mode)
  assert.equal((await h.owner.state()).models.outputs.find(r => r.id === bad.id).content,null,mode)
 }
 setMode('ok')
 await f.upload(2)
 const fresh = await h.owner.command('model.run',request)
 assert.equal(fresh.status,'proposed')
 const freshBefore = (await h.owner.state()).summaries.find(s => s.id === fresh.id)
 assert.equal(freshBefore.stale,false)
 await f.upload(3)
 const state = await h.owner.state(), pinned = state.summaries.find(s => s.id === output.id)
 assert.equal(state.versions.find(v => v.id === state.agreements.find(a => a.id === f.id).current_version_id).number,3)
 assert.equal(pinned.stale,true)
 assert.equal(state.summaries.find(s => s.id === fresh.id).stale,true)
 assert.equal(pinned.content,original.content)
 assert.equal(pinned.version_id,original.version_id)
 const a = state.agreements.find(a => a.id === f.id)
 await h.owner.command('request.update',{agreementId:a.id,version:a.version,title:a.title,ownerId:a.owner_id,currency:'USD',restricted:true})
 assert.deepEqual((await viewer.state()).summaries,[])
 assert.equal((await viewer.request('/api/locket/summaries/'+output.id)).status,404)
 await h.owner.command('access.set',{agreementId:a.id,operatorId:viewer.id,grant:'grant'})
 assert.equal((await read(viewer)).content,original.content)
 await h.owner.command('repository.access',{version:0,enabled:false,grants:[],hiddenFields:[{role:'viewer',fields:['value']}]})
 assert.deepEqual((await viewer.state()).summaries,[])
 assert.equal((await viewer.request('/api/locket/summaries/'+output.id)).status,403)
 await h.owner.command('repository.access',{version:1,enabled:false,grants:[],hiddenFields:[]})
 await h.owner.command('access.set',{agreementId:a.id,operatorId:viewer.id,grant:'revoke'})
 assert.equal((await viewer.request('/api/locket/summaries/'+output.id)).status,404)
 const archive = await (await h.owner.request('/api/locket/export')).json()
 assert.equal(archive.records.lk_model_outputs.find(r => r.id === output.id).content,original.content)
 assert.ok(archive.records.lk_audit.some(r => r.action === 'summary.read' && r.agreement_id === f.id && r.actor_id === viewer.id))
 return f
}
