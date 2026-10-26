import type { Bindings } from '../auth.server'
import { fail } from './model'
import { cents, identity, pantryOrigin, providerDate, providerJson, type AccountingLink, type AccountingRecords } from './accounting-records'

export async function pantryRecords(env:Bindings,link:AccountingLink,since:string,through:string):Promise<AccountingRecords>{
 const origin=pantryOrigin(env),customer=link.record_kind==='customer',result:AccountingRecords={bills:[],invoices:[],payments:[]}
 for(const kind of [customer?'invoices':'bills','payments']){
  let cursor:string|null=null
  const seen=new Set<string>(),cursors=new Set<string>()
  for(let page=0;page<=100;page++){
   const query=new URLSearchParams({limit:'100'})
   if(kind!=='payments')query.set(customer?'customerId':'vendorId',link.vendor_id)
   if(cursor)query.set('cursor',cursor)
   const raw=await providerJson(`${origin}/api/pantry/integration/v1/${kind}?${query}`,{headers:{Authorization:`Bearer ${env.PANTRY_TOKEN}`,Accept:'application/json'}}),rows=raw?.[kind]
   if(!Array.isArray(rows)||rows.length>100||!(raw.nextCursor===null||typeof raw.nextCursor==='string'&&raw.nextCursor.length>0&&raw.nextCursor.length<=500))fail('ACCOUNTING_DATA','Pantry returned an invalid record page.',502)
   for(const row of rows){
    const remoteId=identity(row.id)
    if(seen.has(remoteId))fail('ACCOUNTING_DATA','Pantry repeated a record across pages.',502)
    seen.add(remoteId)
    if(seen.size>10000)fail('ACCOUNTING_DATA','Narrow the accounting selection. No partial total was saved.',502)
    const counterparty=kind==='payments'?row.contact_id:row[customer?'customer_id':'vendor_id']
    if(counterparty!==link.vendor_id){if(kind==='payments')continue;fail('ACCOUNTING_DATA','Pantry returned another counterparty in the linked document read.',502)}
    const day=providerDate(row[kind==='payments'?'payment_date':customer?'issue_date':'bill_date'])
    if(day<since||day>through)continue
    if(kind==='payments'){
     if(row.direction!==(customer?'received':'paid')||!Array.isArray(row.allocations))fail('ACCOUNTING_DATA','Pantry returned an invalid linked payment.',502)
     result.payments.push({id:'payment:'+remoteId,date:day,totalCents:cents(row.amount_cents,true),reversed:row.reversal_id!==null&&row.reversal_id!==undefined,allocations:row.allocations.filter((a:any)=>a.target_kind===(customer?'invoice':'bill')&&!a.voided_by&&!a.voided_on).map((a:any)=>({documentId:(customer?'invoice:':'')+identity(a.target_id),amountCents:cents(a.amount_cents,true)}))})
    }else{
     if(row.status!==(customer?'issued':'posted')||(customer&&row.kind==='credit'))continue
     const amount=cents(row.total_cents,true),balance=cents(row.open_cents,true)
     if(balance>amount)fail('ACCOUNTING_DATA','Pantry returned a balance larger than its document.',502)
     result[customer?'invoices':'bills'].push({id:(customer?'invoice:':'')+remoteId,date:day,dueDate:row.due_date?providerDate(row.due_date):null,totalCents:amount,balanceCents:balance})
    }
   }
   if(raw.nextCursor===null)break
   if(page===100||cursors.has(raw.nextCursor))fail('ACCOUNTING_DATA','Pantry selection is incomplete or too large. No partial snapshot was saved.',502)
   cursor=raw.nextCursor;cursors.add(cursor!)
  }
 }
 return result
}
