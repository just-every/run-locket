import { operationObservation } from './connection-observations'
// Explicit owner handoff of a confirmed obligation as one unposted Pantry bill.
import type { Ctx, Handler } from './commands'
import { commit } from './commands'
import { may, requireRole } from './access'
import { date, fail, json, money, sql, text } from './model'
import { agreementGuards, bump, visibleAgreement } from './records'
import { citation } from './obligations'
import { fullFieldsCheck, policyVersionCheck, repositoryPolicy, requireFullFields } from './repository-access'

type Schedule = {id:string;agreement_id:string;obligation_id:string;agreement_version:number;origin:string;payload:string;citation:string;amount_cents:number;due_date:string;prepared_by:string;status:string;remote_id:string|null}
function pantry(c:Ctx) {
 let url:URL
 try {url=new URL(c.env.PANTRY_ORIGIN??'')}catch{fail('PANTRY_UNAVAILABLE','Configure the server-only Pantry origin and scoped token.',409)}
 if(url.protocol!=='https:'||url.port||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!url.hostname.includes('.')||/^(localhost|.*\.localhost|.*\.local)$/.test(url.hostname)||/^\[|^\d+\./.test(url.hostname)||!c.env.PANTRY_TOKEN)fail('PANTRY_UNAVAILABLE','Pantry requires a public HTTPS origin and a server-only scoped token.',409)
 return url.origin
}
const prepare:Handler=async(c,p)=>{
 requireRole(c.actor,may.manageRoles,'prepare a proposed payment schedule')
 const a=await visibleAgreement(c,p.agreementId)
 if(a.type!=='supplier'||!['executed','imported'].includes(a.status))fail('NOT_EXECUTED','Select an executed supplier agreement.',409)
 const obligationId=text(p,'obligationId',100)
 const obligation=await c.db.prepare("SELECT * FROM lk_obligations WHERE id=? AND agreement_id=? AND status='confirmed'").bind(obligationId,a.id).first<any>()
 if(!obligation||!obligation.due_date)fail('OBLIGATION','Select a confirmed obligation with a due date.',409)
 if(obligation.description.length>500)fail('OBLIGATION','Pantry bill descriptions support at most 500 characters. Confirm a concise payment obligation before preparing this handoff.',409)
 if(obligation.recurrence!=='none')fail('OBLIGATION','Recurring obligations require separately confirmed occurrences; this handoff offers one bill only.',409)
 if(await c.db.prepare('SELECT id FROM lk_accounting_schedules WHERE obligation_id=?').bind(obligationId).first())fail('DUPLICATE_SCHEDULE','This obligation already has a retained schedule handoff. Inspect it before any further action.',409)
 const amount=money(p,'amount')
 if(amount===null||amount<=0)fail('INVALID','Enter a positive exact USD amount.')
 const origin=pantry(c),id=crypto.randomUUID(),dueDate=date({dueDate:obligation.due_date},'dueDate'),billDate=date(p,'billDate')
 if(billDate>dueDate)fail('INVALID','The bill date cannot follow its due date.')
 const source=await citation(c,a,p.citation)
 if(p.confirmAllocation!==true)fail('CONSENT','Confirm that this exact USD amount belongs to the selected contractual obligation.')
 const payload={vendorId:text(p,'vendorId',100),reference:`${a.reference}-${id}`,billDate,dueDate,post:false,lines:[{description:obligation.description,accountId:text(p,'accountId',100),amount:(amount/100).toFixed(2)}]}
 return {allowed:may.manageRoles,result:{id},checks:[...agreementGuards(c,a,p),sql("EXISTS(SELECT 1 FROM lk_obligations WHERE id=? AND status='confirmed' AND due_date=? AND description=? AND recurrence='none')",obligationId,dueDate,obligation.description)],writes:[sql('INSERT INTO lk_accounting_schedules VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,a.id,obligationId,a.version+1,origin,json(payload),json(source),amount,dueDate,c.actor.id,c.now,'draft',null,null,null),bump(c,a)],audit:[{action:'accounting.schedule.prepare',agreementId:a.id,summary:'Owner confirmed exact USD allocation and prepared an unposted Pantry bill for explicit review.'}]}
}
async function schedule(c:Ctx,p:Record<string,unknown>){
 requireRole(c.actor,may.manageRoles,'manage a proposed payment schedule')
 const row=await c.db.prepare('SELECT * FROM lk_accounting_schedules WHERE id=?').bind(text(p,'scheduleId',100)).first<Schedule>()
 if(!row)fail('NOT_FOUND','No proposed schedule has that identity.',404)
 const a=await visibleAgreement(c,row.agreement_id)
 return {row,a}
}
const send:Handler=async(c,p)=>{
 const {row,a}=await schedule(c,p)
 if(row.status!=='draft')fail('STATUS','This proposal already has an outcome. An uncertain attempt is never resent.',409)
 if(a.version!==row.agreement_version||pantry(c)!==row.origin)fail('STALE','The source or destination changed. Do not send this old proposal.',409)
 if(p.consent!==true||p.payload!==row.payload)fail('CONSENT','Review and explicitly authorize the exact retained draft bill payload.')
 return {allowed:may.manageRoles,result:{id:row.id},checks:[...agreementGuards(c,a),sql("(SELECT status FROM lk_accounting_schedules WHERE id=?)='draft'",row.id),sql("EXISTS(SELECT 1 FROM lk_obligations WHERE id=? AND status='confirmed' AND due_date=?)",row.obligation_id,row.due_date)],writes:[sql("UPDATE lk_accounting_schedules SET status='sending',sent_at=? WHERE id=?",c.now,row.id)],audit:[{action:'accounting.schedule.send',agreementId:a.id,summary:'Owner explicitly authorized one unposted Pantry bill. No payment or automatic posting is authorized.'}]}
}
async function remote(c:Ctx,row:Schedule,method:'GET'|'POST'){
 return fetch(`${row.origin}/api/pantry/integration/v1/bills${method==='GET'?'/'+encodeURIComponent(row.remote_id!):''}`,{method,redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${c.env.PANTRY_TOKEN}`,Accept:'application/json',...(method==='POST'?{'Content-Type':'application/json','Idempotency-Key':row.id}:{})},...(method==='POST'?{body:row.payload}:{})})
}
function matchesBill(record:any,row:Schedule){
 const payload=JSON.parse(row.payload),line=record?.lines?.[0]
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
 // An atomic claim precedes the network edge. A crash leaves uncertain, never resendable.
 await commit(c,may.manageRoles,[...agreementGuards(c,a),fullFieldsCheck(c.actor),policyVersionCheck((await repositoryPolicy(c.db)).version),sql("(SELECT status FROM lk_accounting_schedules WHERE id=?)='sending'",id),sql("EXISTS(SELECT 1 FROM lk_obligations WHERE id=? AND status='confirmed' AND due_date=?)",row.obligation_id,row.due_date)],[sql("UPDATE lk_accounting_schedules SET status='uncertain' WHERE id=?",id)])
 if(a.version!==row.agreement_version||pantry(c)!==row.origin){await c.db.prepare("UPDATE lk_accounting_schedules SET status='cancelled' WHERE id=?").bind(id).run();return}
 try{
  const response=await remote(c,row,'POST')
  // A non-success response may follow a remote write; retain uncertainty conservatively.
  if(!response.ok){const observation=operationObservation('pantry',row.origin,c.now,false,'draft_outcome_unknown');await c.db.prepare(observation.sql).bind(...observation.params).run();return}
  const record:any=await receipt(response)
  if(!matchesBill(record,row)||record.status!=='draft'){const observation=operationObservation('pantry',row.origin,c.now,false,'invalid_provider_receipt');await c.db.prepare(observation.sql).bind(...observation.params).run();return}
  const observation=operationObservation('pantry',row.origin,c.now,true,'draft_handoff_succeeded')
  await c.db.batch([sql("UPDATE lk_accounting_schedules SET status='pending',remote_id=?,checked_at=? WHERE id=? AND status='uncertain'",record.id,c.now,id),observation].map(s=>c.db.prepare(s.sql).bind(...s.params)))
 }catch{const observation=operationObservation('pantry',row.origin,c.now,false,'draft_outcome_unknown');await c.db.prepare(observation.sql).bind(...observation.params).run()}
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
  if(!matchesBill(record,row)||record.id!==row.remote_id||!['draft','posted'].includes(record.status))fail('PANTRY_DATA','The retained bill identity, amount or schedule no longer matches. Review it in Pantry.',502)
  status=record.status==='posted'?'accepted':'pending'
 }catch(error){if(error instanceof Error&&'code' in error)throw error;fail('PANTRY_UNAVAILABLE','Pantry could not be read; the prior outcome is preserved.',502)}
 return {allowed:may.manageRoles,result:{id:row.id},checks:[...agreementGuards(c,a),sql('(SELECT status FROM lk_accounting_schedules WHERE id=?)=?',row.id,row.status)],writes:[sql('UPDATE lk_accounting_schedules SET status=?,checked_at=? WHERE id=?',status,c.now,row.id)],audit:[{action:'accounting.schedule.check',agreementId:a.id,summary:status==='accepted'?'Pantry reports the exact scheduled bill posted by its own authorized workflow. Payment remains unconfirmed.':'Pantry draft remains pending human acceptance; no payment is recorded.'}]}
}
export const accountingScheduleHandlers={'accounting.schedule.prepare':prepare,'accounting.schedule.send':send,'accounting.schedule.check':refresh}
