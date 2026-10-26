import type { Bindings } from '../auth.server'
import { fail } from './model'
import { accountingRealm, cents, identity, providerDate, providerJson, type AccountingLink, type AccountingRecords } from './accounting-records'

// SuiteQL reads headers once, so transaction lines cannot multiply document totals.
export async function netsuiteRecords(env:Bindings,link:AccountingLink,since:string,through:string):Promise<AccountingRecords>{
 const account=accountingRealm(env,'netsuite').slice('netsuite:'.length),customer=link.record_kind==='customer',documentType=customer?'CustInvc':'VendBill',paymentType=customer?'CustPymt':'VendPymt',result:AccountingRecords={bills:[],invoices:[],payments:[]},seen=new Set<string>()
 const q=`SELECT t.id, t.type, t.entity, TO_CHAR(t.trandate, 'YYYY-MM-DD') AS transaction_date, TO_CHAR(t.duedate, 'YYYY-MM-DD') AS due_date, ABS(t.foreigntotal) AS total, c.symbol AS currency FROM transaction t INNER JOIN currency c ON c.id=t.currency WHERE t.entity=${link.vendor_id} AND t.type IN ('${documentType}','${paymentType}') AND t.voided='F' AND t.trandate >= TO_DATE('${since}','YYYY-MM-DD') AND t.trandate <= TO_DATE('${through}','YYYY-MM-DD') ORDER BY t.id`
 for(let offset=0;offset<=10000;offset+=100){
  const raw=await providerJson(`https://${account}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=100&offset=${offset}`,{method:'POST',headers:{Authorization:`Bearer ${env.NETSUITE_ACCESS_TOKEN}`,Accept:'application/json','Content-Type':'application/json',Prefer:'transient'},body:JSON.stringify({q})})
  if(!Array.isArray(raw?.items)||raw.items.length>100||raw.offset!==offset||raw.count!==raw.items.length||typeof raw.hasMore!=='boolean')fail('ACCOUNTING_DATA','NetSuite returned an invalid or incomplete page.',502)
  for(const row of raw.items){
   const remoteId=identity(row.id),day=providerDate(row.transaction_date)
   if(seen.has(remoteId)||String(row.entity)!==link.vendor_id||![documentType,paymentType].includes(row.type)||row.currency!=='USD'||day<since||day>through)fail('ACCOUNTING_DATA','NetSuite record identity, counterparty, period or USD currency did not match.',502)
   seen.add(remoteId)
    if(seen.size>10000)fail('ACCOUNTING_DATA','Narrow the accounting selection. No partial total was saved.',502)
   if(row.type===paymentType)result.payments.push({id:'payment:'+remoteId,date:day,totalCents:cents(row.total),reversed:false,allocations:[]})
   else result[customer?'invoices':'bills'].push({id:(customer?'invoice:':'')+remoteId,date:day,dueDate:row.due_date?providerDate(row.due_date):null,totalCents:cents(row.total),balanceCents:null})
  }
  if(!raw.hasMore)break
  if(!raw.items.length||offset===10000)fail('ACCOUNTING_DATA','NetSuite selection is incomplete or too large. No partial snapshot was saved.',502)
 }
 return result
}
