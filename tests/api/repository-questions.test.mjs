import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID,createHash } from 'node:crypto'
import { installation } from './harness.mjs'
import { modelBindings,configureModel } from './model-settings-fixture.mjs'
import { questionFake,questionFixture,readAnswer,selectionQuestion,liabilityQuestion,proposedQuestion,liabilityQuote } from './repository-questions-fixture.mjs'

test('REVIEW-004 asks both repository questions with exact cited matches, current asker custody, proposed values and guarded model records',async t=>{
 const calls=[],control={mode:'ok'},h=await installation({bindings:{...modelBindings,TEST_NOW:String(Date.parse('2026-10-29T12:00:00Z'))},outboundResponse:questionFake(calls,control)})
 t.after(()=>h.close())
 const f=await questionFixture(h),viewer=await h.invite('synthetic-locket-question-viewer@example.test','viewer'),other=await h.invite('synthetic-locket-question-other@example.test','viewer'),agent=await h.invite('synthetic-locket-question-agent@example.test','agent')
 const ask={question:selectionQuestion,consent:true,simulated:true},ownerActor=(await h.owner.state()).actor,viewerActor=(await viewer.state()).actor
 // Compare the complete public command reply, including while the one claimed
 // provider request is held open and after the answer has been accepted.
 const reply=async(person,type,payload,commandId)=>{
  const response=await person.request('/api/locket/commands',{method:'POST',body:{commandId,type,payload}})
  return {status:response.status,body:await response.json()}
 }
 await h.owner.command('question.ask',{...ask,simulated:false},{error:'EVALUATION_REQUIRED'})
 await h.owner.command('question.ask',{...ask,consent:false},{error:'CONSENT'})
 await agent.command('question.ask',ask,{error:'FORBIDDEN'})
 assert.equal(calls.length,0)
 const commandId=randomUUID()
 let dispatched,release
 const atProvider=new Promise(resolve=>{dispatched=resolve}),providerReleased=new Promise(resolve=>{release=resolve})
 control.afterDispatch=async()=>{control.afterDispatch=null;dispatched();await providerReleased}
 const pending=reply(h.owner,'question.ask',ask,commandId)
 let concurrent
 try{
  await Promise.race([atProvider,pending.then(response=>{throw new Error('Question finished before reaching the provider: '+JSON.stringify(response))})])
  concurrent=await reply(h.owner,'question.ask',ask,commandId)
 }finally{release()}
 const first=await pending
 assert.equal(first.status,200);assert.equal(first.body.ok,true)
 assert.deepEqual(concurrent,first,'concurrent replay must retain the complete first command outcome')
 assert.deepEqual(await reply(h.owner,'question.ask',ask,commandId),first)
 const changedPayload=await reply(h.owner,'question.ask',{...ask,question:liabilityQuestion},commandId)
 assert.equal(changedPayload.status,409);assert.equal(changedPayload.body.error.code,'IDEMPOTENCY')
 const result=first.body.result,answer=await readAnswer(h.owner,result.id)
 assert.equal(calls.length,1);assert.equal(answer.status,'proposed');assert.equal(answer.stale,false)
 assert.deepEqual(answer.content.matches.map(m=>m.agreementId).sort(),[f.acme.id,f.restricted.id].sort())
 for(const match of answer.content.matches){assert.equal(match.status,'proposed');assert.equal(match.reliesOnProposed,false);assert.equal(match.citations.length,3);for(const cite of match.citations){assert.equal(cite.status,'confirmed');assert.ok(f.records.find(r=>r.id===match.agreementId).source.includes(cite.quote))}}
 assert.match(answer.prompt_version,/^[a-f0-9]{64}$/)
 const expected=createHash('sha256').update(calls[0].body.messages[0].content).digest('hex');assert.equal(answer.prompt_version,expected)
 assert.equal(JSON.parse(answer.input_digests).documents.length,7);assert.equal(answer.playbookVersion,null)
 const liability=await h.owner.command('question.ask',{...ask,question:liabilityQuestion}),cap=await readAnswer(h.owner,liability.id)
 assert.equal(cap.content.matches[0].value,'USD 250000');assert.equal(cap.content.matches[0].citations[0].quote,liabilityQuote)
 const proposedCommandId=randomUUID(),proposedPayload={...ask,question:proposedQuestion},proposedReply=await reply(h.owner,'question.ask',proposedPayload,proposedCommandId)
 assert.equal(proposedReply.status,200)
 const proposed=proposedReply.body.result,draft=await readAnswer(h.owner,proposed.id)
 assert.equal(draft.content.matches[0].reliesOnProposed,true);assert.equal(draft.content.matches[0].citations.find(c=>c.key==='notice_days').status,'proposed')
 const acceptanceId=randomUUID(),acceptanceReply=await reply(h.owner,'question.accept',{id:proposed.id},acceptanceId)
 assert.equal(acceptanceReply.status,200)
 const acceptedCalls=calls.length
 assert.deepEqual(await reply(h.owner,'question.ask',proposedPayload,proposedCommandId),proposedReply,'accepting an answer must not rewrite the ask outcome')
 assert.deepEqual(await reply(h.owner,'question.accept',{id:proposed.id},acceptanceId),acceptanceReply)
 assert.equal(calls.length,acceptedCalls)
 const accepted=await readAnswer(h.owner,proposed.id)
 assert.equal(accepted.accepted_by,(await h.owner.state()).actor.id)
 assert.equal((await h.owner.state()).terms.find(t=>t.agreement_id===f.proposed.id&&t.key==='notice_days').status,'proposed')
 const own=await viewer.command('question.ask',ask),visible=await readAnswer(viewer,own.id)
 assert.deepEqual(visible.content.matches.map(m=>m.agreementId),[f.acme.id])
 assert.equal(calls.at(-1).input.sources.some(s=>s.id===f.restricted.id),false)
 await readAnswer(other,own.id,404);await readAnswer(viewer,answer.id,404)
 assert.equal((await other.state()).questions.records.length,0)
 // An unsupported provider reply withholds the entire answer and still accounts
 // for supplied provider usage; repeating the exact command never resends it.
 for(const mode of ['quote','foreign','term','reject']){
  control.mode=mode;control.foreignId=f.restricted.id
  const cid=randomUUID(),badReply=await reply(viewer,'question.ask',ask,cid),bad=badReply.body.result,record=await readAnswer(viewer,bad.id)
  assert.equal(record.status,'uncertain',mode);assert.equal(record.content,null,mode)
  const count=calls.length;assert.deepEqual(await reply(viewer,'question.ask',ask,cid),badReply);assert.equal(calls.length,count)
 }
 control.mode='ok'
 for(const provider of ['anthropic','workers-ai']){
  await configureModel(h,{provider})
  const res=await viewer.command('question.ask',{...ask,question:liabilityQuestion})
  assert.equal((await readAnswer(viewer,res.id)).provider,provider)
 }
 await configureModel(h,{enabled:false})
 const count=calls.length;await viewer.command('question.ask',ask,{error:'AI_DISABLED'});assert.equal(calls.length,count)
 await configureModel(h,{enabled:true,provider:'openai'})
 // Loss of one source's access withdraws the whole old answer, including scope
 // and question text. A fresh answer is made from the newly accessible set.
 await h.owner.command('access.set',{agreementId:f.restricted.id,operatorId:viewer.id,grant:'grant'})
 const granted=await viewer.command('question.ask',ask)
 assert.equal((await readAnswer(viewer,granted.id)).content.matches.length,2)
 await h.owner.command('access.set',{agreementId:f.restricted.id,operatorId:viewer.id,grant:'revoke'})
 await readAnswer(viewer,granted.id,404)
 assert.equal((await viewer.state()).questions.records.some(r=>r.id===granted.id),false)
 await h.owner.command('repository.access',{version:0,enabled:false,grants:[],hiddenFields:[{role:'viewer',fields:['value']}]})
 await viewer.command('question.ask',ask,{error:'FIELD_ACCESS'})
 await readAnswer(viewer,own.id,403)
 assert.equal((await viewer.state()).questions.records.length,0)
 await h.owner.command('repository.access',{version:1,enabled:false,grants:[],hiddenFields:[]})
 // A change during the network response leaves the durable claim uncertain;
 // the previously authorized reply never lands against changed source terms.
 control.afterDispatch=async()=>{
  control.afterDispatch=null
  const term=await h.owner.command('term.propose',{agreementId:f.acme.id,key:'notice_days',value:'30',citation:{quote:f.acme.quotes.notice_days}})
  await h.owner.command('term.decide',{agreementId:f.acme.id,termId:term.id,decision:'confirm'})
 }
 const changed=await viewer.command('question.ask',ask)
 assert.equal((await readAnswer(viewer,changed.id)).status,'uncertain')
 assert.equal((await readAnswer(h.owner,answer.id)).stale,true)
 await h.owner.command('question.accept',{id:answer.id},{error:'STALE'})
 const archive=await(await h.owner.request('/api/locket/export')).json()
 assert.equal(archive.records.lk_repository_questions.find(r=>r.id===answer.id).content,JSON.stringify(answer.content))
 const audit=archive.records.lk_audit
 const attributed=(row,actor,agreementId)=>{
  assert.ok(row,'expected attributed question audit entry')
  assert.equal(row.actor_id,actor.id);assert.equal(row.actor_name,actor.name);assert.equal(row.actor_role,actor.role)
  assert.equal(row.at,Date.parse('2026-10-29T12:00:00Z'));assert.equal(row.agreement_id,agreementId)
  assert.equal(typeof row.summary,'string');assert.ok(row.summary.trim().length>0)
  assert.match(row.command_id,/^[0-9a-f-]{36}$/)
 }
 for(const action of ['question.request','question.output']){
  const rows=audit.filter(r=>r.action===action&&r.command_id===commandId)
  assert.equal(rows.length,1,'concurrent and later retries must not duplicate '+action)
  attributed(rows[0],ownerActor,null)
 }
 const acceptEvents=audit.filter(r=>r.action==='question.accept'&&r.command_id===acceptanceId)
 assert.equal(acceptEvents.length,1);attributed(acceptEvents[0],ownerActor,null)
 attributed(audit.find(r=>r.action==='question.read'&&r.actor_id===viewer.id&&r.agreement_id===f.restricted.id),viewerActor,f.restricted.id)
 assert.ok((await h.owner.state()).models.usage.simulatedEstimatedUsd>0)
 // Archive minimization applies to question text and its complete input closure;
 // a hold on any one source retains the immutable answer until released.
 const state=await h.owner.state(),party=state.parties.find(p=>p.id===state.agreements.find(a=>a.id===f.acme.id).party_id),subject='synthetic-locket-subject@example.test'
 await h.owner.command('party.save',{id:party.id,version:party.version,name:party.name,kind:party.kind,contacts:[{name:'Synthetic Subject',email:subject}],signatories:[]})
 const holdAgreement=(await h.owner.state()).agreements.find(a=>a.id===f.restricted.id)
 await h.owner.command('hold.set',{agreementId:holdAgreement.id,version:holdAgreement.version,holdVersion:0,active:true,reason:'Preserve source review',reviewOn:'2026-12-01'})
 const held=await h.owner.command('question.ask',{...ask,question:'What is proposed for '+subject+'?'})
 const erase={email:subject,verified:true,method:'established_channel',receivedOn:'2026-10-29',reason:'privacy_request'}
 const preview=await h.owner.command('person.erase.preview',erase)
 assert.ok(preview.retained.some(r=>r.table==='lk_repository_questions'&&r.id===held.id&&r.reason==='legal_hold'))
 assert.equal((await readAnswer(h.owner,held.id)).question.includes(subject),true)
 await h.owner.command('hold.set',{agreementId:holdAgreement.id,version:holdAgreement.version,holdVersion:1,active:false,reason:'Source hold released'})
 const unheld=await h.owner.command('person.erase.preview',erase)
 assert.ok(unheld.patches.some(p=>p.table==='lk_repository_questions'&&p.id===held.id&&p.after.question&&!p.after.question.includes(subject)))
 await h.owner.command('person.erase',{previewId:unheld.id,fingerprint:unheld.fingerprint,email:subject,draftDispositions:[]})
 assert.equal((await readAnswer(h.owner,held.id)).question.includes(subject),false)
 const before=calls.length
 await viewer.request('/auth/signout',{method:'POST',body:{}})
 assert.equal((await viewer.request('/api/locket/questions/'+own.id)).status,401)
 assert.equal(calls.length,before)
})
