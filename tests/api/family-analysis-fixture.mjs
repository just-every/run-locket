import {familyConflictFixture} from './family-conflict-fixture.mjs'
export const familyModelBindings={AI_ENABLED:'true',AI_MODEL:'synthetic-locket-1',AI_API_KEY:'synthetic-locket-2'}
// Test-only OpenAI-compatible provider edge; input still crosses the actual
// product command, consent, provider client and citation-validation doors.
export function familyModelFake(calls,mode=()=> 'ok') {
 return async request=>{
  const body=await request.json();calls.push({url:request.url,body})
  const sources=JSON.parse(body.messages.at(-1).content).sources
  const candidates=sources.map(s=>({agreementId:s.agreementId,value:s.terms.find(t=>t.key==='notice_days').value,quote:mode()==='bad-quote'?'Words not in any executed source.':s.pages[0].text,page:s.pages[0].page}))
  const notice={key:'notice_days',summary:'The MSA, amendment and order state different notice periods.',recommended:candidates.findIndex(c=>c.value==='90'),reasoning:'The amendment expressly changes the notice period; counsel must confirm its scope and precedence.',candidates}
  const conflicts=[notice]
  if(sources.every(s=>s.pages[0].text.includes('Annual price')))for(const key of ['price','precedence'])conflicts.push({key,summary:key==='price'?'The executed texts state three annual prices.':'The documents assert incompatible precedence.',recommended:notice.recommended,reasoning:'The signed amendment states its intended override; counsel must decide its effective scope.',candidates:candidates.map(c=>({...c,value:key==='price'?c.value==='60'?'USD 100,000':c.value==='90'?'USD 110,000':'USD 120,000':c.value==='60'?'MSA over orders':c.value==='90'?'Amendment over MSA':'Order over MSA'}))})
  return Response.json({choices:[{message:{content:JSON.stringify({conflicts})}}]})
 }
}
export async function familyAnalysisFixture(client) {
 const f=await familyConflictFixture(client,{withLegalText:true,initialFutureTerm:true})
 const owner=(await client.state()).actor.id
 const obligation=await client.command('obligation.add',{agreementId:f.master.id,description:'Prepare the notice decision',ownerId:owner,dueDate:'2026-12-30',recurrence:'none',evidence:'note',citation:{quote:f.master.quote,page:1}})
 await client.command('obligation.update',{agreementId:f.master.id,obligationId:obligation.id,action:'confirm'})
 return {...f,obligation}
}
