import {file,pdf} from './files.mjs'
import assert from 'node:assert/strict'
export const pantryBindings={PANTRY_ORIGIN:'https://pantry.example.test',PANTRY_TOKEN:'synthetic-locket-3'}
export function pantryFake(calls,mode=()=> 'draft'){
 const records=new Map()
 return async request=>{
  const url=new URL(request.url)
  if(url.origin!==pantryBindings.PANTRY_ORIGIN)throw new Error('Unexpected accounting destination')
  const body=request.method==='POST'?await request.json():null
  calls.push({method:request.method,url:request.url,body,key:request.headers.get('Idempotency-Key'),authorization:request.headers.get('Authorization')})
  if(mode()==='failure')return Response.json({error:'synthetic-locket-4'},{status:503})
  if(mode()==='unknown')throw new Error('synthetic-locket-5')
  let record
  if(body){const amount=Math.round(Number(body.lines[0].amount??body.lines[0].rate)*100),id='synthetic-locket-'+(records.size+6);record={id,...(body.customerId?{customer_id:body.customerId,number:body.number,issue_date:body.issueDate}:{vendor_id:body.vendorId,reference:body.reference,bill_date:body.billDate}),due_date:body.dueDate,total_cents:amount,status:'draft',lines:[{description:body.lines[0].description,account_id:body.lines[0].accountId,amount_cents:amount,...(body.customerId?{quantity_milli:1000,unit_cents:amount,tax_code:'exempt',tax_cents:0}:{})}]};records.set(id,record)}else record=records.get(decodeURIComponent(url.pathname.split('/').at(-1)))
  return Response.json({...record,status:mode()==='posted'?(record?.customer_id?'issued':'posted'):'draft',...(mode()==='changed'?{total_cents:1}:{})})
 }
}
export async function configurePantry(h,origin=pantryBindings.PANTRY_ORIGIN){
 const prior=(await h.owner.state()).connections.find(c=>c.id==='pantry')
 return h.owner.command('accounting.destination.configure',{revision:prior?.connectionVersion??0,origin,consent:true})
}
export async function scheduleFixture(h,{restricted=false,type='supplier',recurrence='none',dueDate='2026-11-01',quoteSuffix='',description='Implementation payment'}={}){
 if(!(await h.owner.state()).connections.find(c=>c.id==='pantry')?.connectionVersion)await configurePantry(h)
 const quote='Pay USD 1,250.50 on November 1, 2026 for implementation. '+crypto.randomUUID()+' '+quoteSuffix
 const source=await h.owner.command('legacy.import',{title:type==='customer'?'Synthetic customer services agreement':'Synthetic supplier implementation agreement',type,party:{name:'synthetic-locket counterparty',kind:type},value:'100000',file:file(type==='customer'?'customer-agreement.pdf':'supplier-agreement.pdf',pdf(quote)),text:quote,sourceSystem:'Authorized archive',sourceId:crypto.randomUUID(),signed:true,restricted})
 const obligation=await h.owner.command('obligation.add',{agreementId:source.id,description,ownerId:(await h.owner.state()).actor.id,dueDate,recurrence,evidence:'note',citation:{quote}})
 const current=async()=>(await h.owner.state()).agreements.find(a=>a.id===source.id)
 const prepare=async(extra={})=>h.owner.command('accounting.schedule.prepare',{agreementId:source.id,version:(await current()).version,obligationId:obligation.id,amount:'1250.50',billDate:'2026-10-26',...(type==='customer'?{customerId:'synthetic-locket-7',taxCode:'exempt'}:{vendorId:'synthetic-locket-7'}),accountId:'synthetic-locket-8',citation:{quote},confirmAllocation:true,...extra})
 const confirm=()=>h.owner.command('obligation.update',{agreementId:source.id,obligationId:obligation.id,action:'confirm'})
 const row=async(id)=>(await h.owner.state()).accountingSchedules.find(r=>r.id===id)
 return {source,obligation,quote,current,prepare,confirm,row}
}

// Extend the existing public-door refusal journey, with only Pantry transport faked.
export async function accountingDestinationChanges(){
 for(const phase of ['before-send','send-response','before-check','check-response']){
  const calls=[],entered=Promise.withResolvers(),release=Promise.withResolvers()
  let pause=false,mode='draft'
  const fake=pantryFake(calls,()=>mode)
  const {installation}=await import('./harness.mjs')
  const h=await installation({bindings:pantryBindings,outboundResponse:async request=>{
   const response=await fake(request)
   if(pause){entered.resolve();await release.promise}
   return response
  }})
  let pending
  try{
   await h.setTime(Date.parse('2026-10-27T12:00:00Z'))
   const f=await scheduleFixture(h);await f.confirm()
   const proposal=await f.prepare(),row=await f.row(proposal.id)
   assert.equal(row.destination_revision,1)
   const send={scheduleId:row.id,payload:row.payload,consent:true},commandId=crypto.randomUUID(),checkedCommandId=crypto.randomUUID()
   const archive=async()=>await(await h.owner.request('/api/locket/export')).json()
   const original=await archive()
   if(phase==='before-send'){
    const viewer=await h.invite(['synthetic-locket-destination','example.test'].join('@'),'viewer')
    const before=await archive()
    await viewer.command('accounting.destination.configure',{revision:1,origin:pantryBindings.PANTRY_ORIGIN,consent:true},{error:'FORBIDDEN'})
    await viewer.command('accounting.destination.invalidate',{revision:1,consent:true},{error:'FORBIDDEN'})
    await h.owner.command('accounting.destination.configure',{revision:1,origin:pantryBindings.PANTRY_ORIGIN,consent:false},{error:'CONSENT'})
    await h.owner.command('accounting.destination.configure',{revision:1,origin:'http://localhost',consent:true},{error:'PANTRY_UNAVAILABLE'})
    assert.deepEqual((await archive()).records.lk_accounting_destinations,before.records.lk_accounting_destinations)
   }else if(phase==='send-response'){
    pause=true;pending=h.owner.command('accounting.schedule.send',send,{commandId})
   }else{
    await h.owner.command('accounting.schedule.send',send)
    assert.equal((await f.row(row.id)).status,'pending')
    if(phase==='before-check'){
     await h.owner.command('accounting.schedule.check',{scheduleId:row.id},{commandId:checkedCommandId})
     const checked=await archive(),reads=calls.length
     await h.owner.command('accounting.schedule.check',{scheduleId:row.id},{commandId:checkedCommandId})
     assert.deepEqual((await archive()).records,checked.records,'An unchanged check replay retains the same outcome without a new read or audit')
     assert.equal(calls.length,reads)
    }
    if(phase==='check-response'){
     mode='posted';pause=true
     pending=h.owner.command('accounting.schedule.check',{scheduleId:row.id},{commandId,error:'STALE'})
    }
   }
   if(pending){
    let timer
    try{await Promise.race([entered.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Pantry response was not reached')),10000)})])}finally{clearTimeout(timer)}
   }
   const before=await archive()
   await configurePantry(h,'https://pantry-replacement.example.test')
   const connection=(await h.owner.state()).connections.find(c=>c.id==='pantry')
   assert.equal(connection.serverMatches,false)
   assert.equal(connection.connectionVersion,2)
   if(phase==='before-send'){
    await h.owner.command('accounting.schedule.send',send,{error:'STALE'})
    await h.owner.command('accounting.schedule.prepare',{agreementId:f.source.id,version:(await f.current()).version,obligationId:f.obligation.id,amount:'1250.50',billDate:'2026-10-26',vendorId:'synthetic-locket-7',accountId:'synthetic-locket-8',citation:{quote:f.quote},confirmAllocation:true},{error:'STALE'})
   }
   if(phase==='before-check'){
    const replaced=await archive()
    await h.owner.command('accounting.schedule.check',{scheduleId:row.id},{error:'STALE'})
    await h.owner.command('accounting.schedule.check',{scheduleId:row.id},{commandId:checkedCommandId,error:'STALE'})
    assert.deepEqual((await archive()).records,replaced.records,'Refused acceptance checks change nothing at the replacement destination')
   }
   // Restoring the former origin must not restore its former consent revision.
   await configurePantry(h)
   const afterChange=await archive()
   if(pending){release.resolve();await pending}
   const after=await archive()
   assert.deepEqual(after.records.lk_accounting_schedules,afterChange.records.lk_accounting_schedules,phase+': changed destination cannot record a provider outcome')
   assert.deepEqual(after.records.lk_connection_health,afterChange.records.lk_connection_health,phase+': no stale success observation')
   assert.deepEqual(after.records.lk_audit.filter(a=>a.command_id===commandId),afterChange.records.lk_audit.filter(a=>a.command_id===commandId),phase+': no completion audit')
   assert.deepEqual(after.records.lk_agreements.find(a=>a.id===f.source.id),original.records.lk_agreements.find(a=>a.id===f.source.id))
   assert.deepEqual(after.records.lk_repository_policy,original.records.lk_repository_policy)
   if(phase==='send-response')assert.equal(before.records.lk_accounting_schedules[0].remote_id,null)
   if(phase==='before-send'){
    await h.owner.command('accounting.schedule.send',send,{error:'STALE'})
    assert.equal(calls.length,0)
    await h.owner.command('accounting.destination.invalidate',{revision:3,consent:true})
    assert.equal((await h.owner.state()).connections.find(c=>c.id==='pantry').destinationEnabled,false)
    await configurePantry(h)
    await h.owner.command('accounting.schedule.send',send,{error:'STALE'})
    assert.equal(calls.length,0)
    const fresh=await f.prepare(),freshRow=await f.row(fresh.id)
    assert.notEqual(fresh.id,row.id)
    assert.equal(freshRow.destination_revision,5)
    assert.equal(freshRow.destination_current,true)
    const superseded=await f.row(row.id)
    assert.equal(superseded.status,'cancelled')
    assert.equal(superseded.payload,row.payload)
    assert.equal(superseded.destination_revision,1)
    assert.equal(calls.length,0)
   }else if(phase==='send-response'){
    assert.equal(after.records.lk_accounting_schedules[0].status,'uncertain')
    assert.equal(after.records.lk_accounting_schedules[0].remote_id,null)
    await h.owner.command('accounting.schedule.send',send,{commandId})
    await h.owner.command('accounting.schedule.send',send,{error:'STATUS'})
    await h.owner.command('accounting.schedule.check',{scheduleId:row.id},{error:'STATUS'})
    assert.equal(calls.length,1)
   }else{
    await h.owner.command('accounting.schedule.check',{scheduleId:row.id},{error:'STALE'})
    if(phase==='before-check')await h.owner.command('accounting.schedule.check',{scheduleId:row.id},{commandId:checkedCommandId,error:'STALE'})
    assert.equal((await f.row(row.id)).status,'pending')
    assert.equal(calls.filter(c=>c.method==='POST').length,1)
    assert.equal(calls.filter(c=>c.method==='GET').length,1)
    assert.deepEqual((await archive()).records,after.records,'Refused acceptance checks change nothing after restoring the former destination')
   }
   const retained=(await archive()).records
   assert.equal(retained.lk_accounting_schedules[0].destination_revision,1)
   assert.equal(retained.lk_accounting_destinations[0].configured_by,(await h.owner.state()).actor.id)
   assert.ok(!JSON.stringify(retained).includes(pantryBindings.PANTRY_TOKEN))
  }finally{release.resolve();if(pending)await pending.catch(()=>{});await h.close()}
 }
}
