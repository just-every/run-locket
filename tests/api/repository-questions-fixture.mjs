import assert from 'node:assert/strict'
import { file, pdf } from './setup.mjs'
import { configureModel } from './model-settings-fixture.mjs'
export const selectionQuestion="Which supplier agreements auto-renew next quarter with more than 60 days' notice?"
export const liabilityQuestion='What is our liability cap with Acme?'
export const proposedQuestion='What notice period is proposed for Proposed Supplier?'
export const liabilityQuote='Liability is capped at USD 250000.'
export async function questionFixture(h) {
 const records=[]
 for(const [title,type,end,notice,auto,restricted,proposed] of [
  ['Acme supplier','supplier','2027-02-15','90','yes',false,false],
  ['Restricted Supplier','supplier','2027-03-01','120','yes',true,false],
  ['Sixty Day Supplier','supplier','2027-02-15','60','yes',false,false],
  ['Later Supplier','supplier','2027-06-15','90','yes',false,false],
  ['Fixed Supplier','supplier','2027-02-15','90','no',false,false],
  ['Customer Contract','customer','2027-02-15','90','yes',false,false],
  ['Proposed Supplier','supplier','2027-02-15','90','yes',false,true],
  ['Private NDA','nda','2027-02-15','90','yes',false,false],
 ]) {
  const quotes={effective_date:'The effective date is 2026-02-15.',end_date:`The current term ends on ${end}.`,auto_renew:`Automatic renewal: ${auto}.`,renewal_term_months:'The renewal term is 12 months.',notice_days:`Nonrenewal requires ${notice} days notice.`}
  const source=title+'\n'+Object.values(quotes).join('\n')+'\n'+liabilityQuote
  const a=await h.owner.command('legacy.import',{title,type,restricted,party:{name:title,kind:'supplier'},sourceSystem:'Shared drive',sourceId:'questions-'+records.length,signed:true,text:source,file:file(`synthetic-locket-${records.length+1}.pdf`,pdf(source))})
  for(const [key,value] of Object.entries({effective_date:'2026-02-15',end_date:end,auto_renew:auto,renewal_term_months:'12',notice_days:notice})){
   const term=await h.owner.command('term.propose',{agreementId:a.id,key,value,citation:{quote:quotes[key]}})
   if(!proposed||key!=='notice_days')await h.owner.command('term.decide',{agreementId:a.id,termId:term.id,decision:'confirm'})
  }
  records.push({...a,title,source,quotes})
 }
 await configureModel(h,{disabledTypes:['nda']})
 return {records,acme:records[0],restricted:records[1],proposed:records[6]}
}
export function questionFake(calls,control={mode:'ok'}) {
 return async request=>{
  const body=await request.json(),prompt=body.system??body.messages[0].content,input=JSON.parse(body.messages.at(-1).content)
  assert.match(prompt,/^locket-questions-v1:/)
  assert.equal(input.asOf,'2026-10-29')
  assert.equal(input.sources.some(s=>s.title==='Private NDA'),false)
  assert.ok(input.sources.every(s=>s.documents.length>0))
  calls.push({url:request.url,body,input})
  if(control.afterDispatch)await control.afterDispatch()
  if(control.mode==='reject')return new Response('synthetic provider unavailable',{status:503})
  let selected=input.sources.filter(s=>input.question===selectionQuestion?['Acme supplier','Restricted Supplier'].includes(s.title):input.question===liabilityQuestion?s.title==='Acme supplier':s.title==='Proposed Supplier')
  let matches=selected.map(s=>({agreementId:s.id,value:input.question===selectionQuestion?'Auto-renews next quarter with more than 60 days notice':input.question===liabilityQuestion?'USD 250000':'90 days, proposed and unconfirmed',citations:input.question===liabilityQuestion?[{quote:liabilityQuote}]:s.terms.filter(t=>['end_date','auto_renew','notice_days'].includes(t.key)).map(t=>({quote:t.quote,termId:t.id})),status:'confirmed'}))
  if(control.mode==='quote')matches[0].citations[0].quote='An invented passage.'
  if(control.mode==='foreign')matches[0].agreementId=control.foreignId
  if(control.mode==='term')matches[0].citations[0].termId='synthetic-absent'
  if(control.mode==='empty')matches=[]
  const content=JSON.stringify({matches})
  if(new URL(request.url).hostname==='api.anthropic.com')return Response.json({content:[{type:'text',text:content}],usage:{input_tokens:1000,output_tokens:500}})
  if(new URL(request.url).hostname==='api.cloudflare.com')return Response.json({success:true,result:{response:content,usage:{prompt_tokens:1000,completion_tokens:500}}})
  return Response.json({choices:[{message:{content}}],usage:{prompt_tokens:1000,completion_tokens:500}})
 }
}
export async function readAnswer(person,id,status=200){const res=await person.request('/api/locket/questions/'+id);assert.equal(res.status,status,await res.clone().text());return res.json()}
