import { operationObservation } from './connection-observations'
import { pantryOrigin } from './accounting-records'
import { paymentOccurrences } from './accounting-occurrences'
// Explicit owner handoff of a confirmed obligation as explicit unposted Pantry drafts.
import type { Ctx, Handler } from './commands'
import { auditSql, commit } from './commands'
import { may, requireRole } from './access'
import { date, fail, json, money, sql, text, sha256 } from './model'
import { agreementGuards, visibleAgreement } from './records'
import { citation } from './obligations'
import { fullFieldsCheck, policyVersionCheck, repositoryPolicy, requireFullFields } from './repository-access'

type Schedule = {id:string;agreement_id:string;obligation_id:string;agreement_version:number;origin:string;payload:string;citation:string;amount_cents:number;due_date:string;prepared_by:string;status:string;remote_id:string|null}
const pantry=(c:Ctx)=>pantryOrigin(c.env)
const prepare:Handler=async(c,p)=>{
 requireRole(c.actor,may.manageRoles,'prepare a proposed payment schedule')
 const a=await visibleAgreement(c,p.agreementId)
 if(!['supplier','customer'].includes(a.type)||!['executed','imported'].includes(a.status))fail('NOT_EXECUTED','Select an executed supplier or customer agreement.',409)
 if(a.type==='customer'&&p.taxCode!=='exempt')fail('BILLING_MAPPING','Confirm the exempt tax treatment explicitly before proposing an invoice. Other tax mappings require review in Pantry.',409)
 const obligationId=text(p,'obligationId',100)
 const obligation=await c.db.prepare("SELECT * FROM lk_obligations WHERE id=? AND agreement_id=? AND status='confirmed'").bind(obligationId,a.id).first<any>()
 if(!obligation||!obligation.due_date)fail('OBLIGATION','Select a confirmed obligation with a due date.',409)
 if(obligation.description.length>500)fail('OBLIGATION','Pantry bill descriptions support at most 500 characters. Confirm a concise payment obligation before preparing this handoff.',409)
 const amount=money(p,'amount')
 if(amount===null||amount<=0)fail('INVALID','Enter a positive exact USD amount.')
 const origin=pantry(c),id=crypto.randomUUID(),dueDate=date({dueDate:obligation.due_date},'dueDate'),billDate=date(p,'billDate')
 if(billDate>dueDate)fail('INVALID','The bill date cannot follow its due date.')
 const source=await citation(c,a,p.citation)
 if(p.confirmAllocation!==true)fail('CONSENT','Confirm that this exact USD amount belongs to the selected contractual obligation.')
 const occurrences=paymentOccurrences(p,obligation.recurrence,dueDate,billDate),counterpartyId=text(p,a.type==='customer'?'customerId':'vendorId',100),accountId=text(p,'accountId',100)
 const existing=(await c.db.prepare('SELECT due_date FROM lk_accounting_schedules WHERE obligation_id=?').bind(obligationId).all<{due_date:string}>()).results
 if(existing.some(row=>occurrences.some(o=>o.dueDate===row.due_date)))fail('DUPLICATE_SCHEDULE','An occurrence already has a retained schedule handoff. Inspect it before any further action.',409)
 const rows=occurrences.map((occurrence,index)=>{
  if(occurrence.billDate>occurrence.dueDate)fail('INVALID','An occurrence bill date cannot follow its due date.')
  const rowId=index===0?id:crypto.randomUUID(),amountText=(amount/100).toFixed(2),payload=a.type==='customer'?{customerId:counterpartyId,number:`${a.reference}-${rowId}`,issueDate:occurrence.billDate,dueDate:occurrence.dueDate,post:false,lines:[{description:obligation.description,accountId,quantity:'1',rate:amountText,taxCode:'exempt'}]}:{vendorId:counterpartyId,reference:`${a.reference}-${rowId}`,billDate:occurrence.billDate,dueDate:occurrence.dueDate,post:false,lines:[{description:obligation.description,accountId,amount:amountText}]}
  return {id:rowId,payload,...occurrence}
 })
 return {allowed:may.manageRoles,result:{id,ids:rows.map(row=>row.id)},checks:[...agreementGuards(c,a,p),sql("EXISTS(SELECT 1 FROM lk_obligations WHERE id=? AND status='confirmed' AND due_date=? AND description=? AND recurrence=?)",obligationId,dueDate,obligation.description,obligation.recurrence),...rows.map(row=>sql('NOT EXISTS(SELECT 1 FROM lk_accounting_schedules WHERE obligation_id=? AND due_date=?)',obligationId,row.dueDate))],writes:[...rows.map(row=>sql('INSERT INTO lk_accounting_schedules VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',row.id,a.id,obligationId,a.version,origin,json(row.payload),json({...source,recurrence:obligation.recurrence,firstDueDate:dueDate}),amount,row.dueDate,c.actor.id,c.now,'draft',null,null,null))],audit:[{action:'accounting.schedule.prepare',agreementId:a.id,summary:'Owner confirmed exact USD allocation and finite dated occurrences as unposted Pantry drafts. Each occurrence requires separate exact outbound consent.'}]}

}
async function schedule(c:Ctx,p:Record<string,unknown>){
 requireRole(c.actor,may.manageRoles,'manage a proposed payment schedule')
 const row=await c.db.prepare('SELECT * FROM lk_accounting_schedules WHERE id=?').bind(text(p,'scheduleId',100)).first<Schedule>()
 if(!row)fail('NOT_FOUND','No proposed schedule has that identity.',404)
 const a=await visibleAgreement(c,row.agreement_id)
 return {row,a}
}
function obligationGuard(row:Schedule){
 const source=JSON.parse(row.citation)
 return sql("EXISTS(SELECT 1 FROM lk_obligations WHERE id=? AND status='confirmed' AND due_date=? AND recurrence=?)",row.obligation_id,source.firstDueDate??row.due_date,source.recurrence??'none')
}
const send:Handler=async(c,p)=>{
 const {row,a}=await schedule(c,p)
 if(row.status!=='draft')fail('STATUS','This proposal already has an outcome. An uncertain attempt is never resent.',409)
 if(a.version!==row.agreement_version||pantry(c)!==row.origin)fail('STALE','The source or destination changed. Do not send this old proposal.',409)
 if(p.consent!==true||p.payload!==row.payload)fail('CONSENT','Review and explicitly authorize the exact retained accounting draft payload.')
 return {allowed:may.manageRoles,result:{id:row.id},checks:[...agreementGuards(c,a),sql("(SELECT status FROM lk_accounting_schedules WHERE id=?)='draft'",row.id),obligationGuard(row)],writes:[sql("UPDATE lk_accounting_schedules SET status='sending',sent_at=? WHERE id=?",c.now,row.id)],audit:[{action:'accounting.schedule.send',agreementId:a.id,summary:'Owner explicitly authorized one unposted Pantry draft. No payment or automatic posting is authorized.'}]}
}
async function remote(c:Ctx,row:Schedule,method:'GET'|'POST'){
 const resource=JSON.parse(row.payload).customerId?'invoices':'bills'
 return fetch(`${row.origin}/api/pantry/integration/v1/${resource}${method==='GET'?'/'+encodeURIComponent(row.remote_id!):''}`,{method,redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${c.env.PANTRY_TOKEN}`,Accept:'application/json',...(method==='POST'?{'Content-Type':'application/json','Idempotency-Key':row.id}:{})},...(method==='POST'?{body:row.payload}:{})})
}
function matchesBill(record:any,row:Schedule){
 const payload=JSON.parse(row.payload),line=record?.lines?.[0]
 if(payload.customerId)return record&&typeof record.id==='string'&&record.id.length>0&&record.id.length<=100&&record.customer_id===payload.customerId&&record.number===payload.number&&record.issue_date===payload.issueDate&&record.due_date===payload.dueDate&&record.total_cents===row.amount_cents&&record.lines?.length===1&&line.description===payload.lines[0].description&&line.account_id===payload.lines[0].accountId&&line.amount_cents===row.amount_cents&&line.quantity_milli===1000&&line.unit_cents===row.amount_cents&&line.tax_code==='exempt'&&line.tax_cents===0
 return record&&typeof record.id==='string'&&record.id.length>0&&record.id.length<=100&&record.vendor_id===payload.vendorId&&record.reference===payload.reference&&record.bill_date===payload.billDate&&record.due_date===payload.dueDate&&record.total_cents===row.amount_cents&&record.lines?.length===1&&line.description===payload.lines[0].description&&line.account_id===payload.lines[0].accountId&&line.amount_cents===row.amount_cents
}
async function receipt(response:Response){
 const reader=response.body?.getReader()
 if(!reader)fail('PANTRY_DATA','Pantry returned an empty receipt.',502)
 const chunks:Uint8Array[]= [];let size=0
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576)fail('PANTRY_DATA','Pantry returned an oversized receipt.',502);chunks.push(value)}}finally{await reader.cancel()}
 const bytes=new Uint8Array(size);let offset=0
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 return JSON.parse(new TextDecoder().decode(bytes))
}
/** Called only after the explicit send command commits; the one-use claim fences retries. */
export async function dispatchAccountingSchedule(c:Ctx,id:string){
 requireRole(c.actor,may.manageRoles,'read payment handoff outcomes')
 await requireFullFields(c.db,c.actor)
 const row=await c.db.prepare('SELECT * FROM lk_accounting_schedules WHERE id=?').bind(id).first<Schedule>()
 if(!row)return
 const a=await visibleAgreement(c,row.agreement_id)
 if(row.status!=='sending')return
 if(a.version!==row.agreement_version||pantry(c)!==row.origin)return
 const checks=[...agreementGuards(c,a),fullFieldsCheck(c.actor),policyVersionCheck((await repositoryPolicy(c.db)).version),obligationGuard(row),sql('EXISTS(SELECT 1 FROM lk_accounting_schedules WHERE id=? AND origin=? AND payload=? AND citation=? AND agreement_version=? AND amount_cents=? AND due_date=? AND prepared_by=?)',row.id,row.origin,row.payload,row.citation,row.agreement_version,row.amount_cents,row.due_date,row.prepared_by)]
 // An atomic claim precedes the network edge. A crash leaves uncertain, never resendable.
 await commit(c,may.manageRoles,[...checks,sql("(SELECT status FROM lk_accounting_schedules WHERE id=?)='sending'",id)],[sql("UPDATE lk_accounting_schedules SET status='uncertain' WHERE id=?",id)])
 const payloadDigest=await sha256(row.payload)
 const recordOutcome=(writes:ReturnType<typeof sql>[],outcome:string)=>commit(c,may.manageRoles,[...checks,sql("(SELECT status FROM lk_accounting_schedules WHERE id=?)='uncertain'",id)],[...writes,auditSql(c,{action:'accounting.schedule.outcome',agreementId:a.id,summary:json({scheduleId:id,payloadDigest,outcome})})])
 try{
  const response=await remote(c,row,'POST')
  // A non-success response may follow a remote write; retain uncertainty conservatively.
  if(!response.ok){const observation=operationObservation('pantry',row.origin,c.now,false,'draft_outcome_unknown');await recordOutcome([observation],'uncertain');return}
  const record:any=await receipt(response)
  if(!matchesBill(record,row)||record.status!=='draft'){const observation=operationObservation('pantry',row.origin,c.now,false,'invalid_provider_receipt');await recordOutcome([observation],'uncertain');return}
  const observation=operationObservation('pantry',row.origin,c.now,true,'draft_handoff_succeeded')
  await recordOutcome([sql("UPDATE lk_accounting_schedules SET status='pending',remote_id=?,checked_at=? WHERE id=? AND status='uncertain'",record.id,c.now,id),observation],'pending')
 }catch{
  // Lost authority or changed bindings cannot record even a failure observation.
  // The pre-dispatch uncertain claim already records the unresolved attempt.
  try{await recordOutcome([operationObservation('pantry',row.origin,c.now,false,'draft_outcome_unknown')],'uncertain')}catch{}
 }
}
const refresh:Handler=async(c,p)=>{
 const {row,a}=await schedule(c,p)
 if(!['pending','accepted'].includes(row.status)||!row.remote_id)fail('STATUS','Only a known Pantry draft can be checked.',409)
 if(pantry(c)!==row.origin)fail('STALE','The configured Pantry destination changed.',409)
 let status:string
 try{
  const response=await remote(c,row,'GET')
  if(!response.ok)fail('PANTRY_UNAVAILABLE','Pantry refused the read; the existing proposal outcome is preserved.',502)
  const record:any=await receipt(response)
  if(!matchesBill(record,row)||record.id!==row.remote_id||!['draft',JSON.parse(row.payload).customerId?'issued':'posted'].includes(record.status))fail('PANTRY_DATA','The retained bill identity, amount or schedule no longer matches. Review it in Pantry.',502)
  status=record.status==='draft'?'pending':'accepted'
 }catch(error){if(error instanceof Error&&'code' in error)throw error;fail('PANTRY_UNAVAILABLE','Pantry could not be read; the prior outcome is preserved.',502)}
 return {allowed:may.manageRoles,result:{id:row.id},checks:[...agreementGuards(c,a),sql('(SELECT status FROM lk_accounting_schedules WHERE id=?)=?',row.id,row.status)],writes:[sql('UPDATE lk_accounting_schedules SET status=?,checked_at=? WHERE id=?',status,c.now,row.id)],audit:[{action:'accounting.schedule.check',agreementId:a.id,summary:status==='accepted'?'Pantry reports the exact scheduled draft accepted by its own authorized workflow. Payment remains unconfirmed.':'Pantry draft remains pending human acceptance; no payment is recorded.'}]}
}
export const accountingScheduleHandlers={'accounting.schedule.prepare':prepare,'accounting.schedule.send':send,'accounting.schedule.check':refresh}
