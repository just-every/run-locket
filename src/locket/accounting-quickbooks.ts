import type { Bindings } from '../auth.server'
import { fail } from './model'
import { accountingRealm, cents, identity, providerDate, providerJson, type AccountingLink, type AccountingRecords } from './accounting-records'

export async function quickbooksRecords(env:Bindings,link:AccountingLink,since:string,through:string):Promise<AccountingRecords>{
 const realm=accountingRealm(env,'quickbooks'),host=env.QUICKBOOKS_SANDBOX==='true'?'sandbox-quickbooks.api.intuit.com':'quickbooks.api.intuit.com',customer=link.record_kind==='customer',ref=customer?'CustomerRef':'VendorRef'
 const result:AccountingRecords={bills:[],invoices:[],payments:[]}
 for(const kind of [customer?'Invoice':'Bill',customer?'Payment':'BillPayment']){
  const seen=new Set<string>()
  for(let start=1;start<=10001;start+=100){
   const query=`SELECT * FROM ${kind} WHERE ${ref} = '${link.vendor_id}' AND TxnDate >= '${since}' AND TxnDate <= '${through}' STARTPOSITION ${start} MAXRESULTS 100`
   const raw=await providerJson(`https://${host}/v3/company/${realm}/query?query=${encodeURIComponent(query)}&minorversion=75`,{headers:{Authorization:`Bearer ${env.QUICKBOOKS_ACCESS_TOKEN}`,Accept:'application/json'}})
   const rows=raw?.QueryResponse?.[kind]??(raw?.QueryResponse?[]:null)
   if(!Array.isArray(rows)||rows.length>100)fail('ACCOUNTING_DATA','QuickBooks returned an invalid record page.',502)
   for(const row of rows){
    const remoteId=identity(row.Id),day=providerDate(row.TxnDate),id=(kind==='Invoice'?'invoice:':'')+remoteId
    if(seen.has(remoteId)||row[ref]?.value!==link.vendor_id||row.CurrencyRef?.value!=='USD'||day<since||day>through)fail('ACCOUNTING_DATA','QuickBooks record identity, counterparty, period or USD currency did not match.',502)
    seen.add(remoteId)
    if(seen.size>10000)fail('ACCOUNTING_DATA','Narrow the accounting selection. No partial total was saved.',502)
    if(kind==='Bill'||kind==='Invoice'){
     const amount=cents(row.TotalAmt),balance=cents(row.Balance)
     if(balance>amount)fail('ACCOUNTING_DATA','QuickBooks returned a balance larger than its document.',502)
     result[customer?'invoices':'bills'].push({id,date:day,dueDate:row.DueDate?providerDate(row.DueDate):null,totalCents:amount,balanceCents:balance})
    }else{
     const allocations=(row.Line??[]).flatMap((line:any)=>(line.LinkedTxn??[]).length===1&&line.LinkedTxn[0].TxnType===(customer?'Invoice':'Bill')?[{documentId:(customer?'invoice:':'')+identity(line.LinkedTxn[0].TxnId),amountCents:cents(line.Amount)}]:[])
     result.payments.push({id:'payment:'+remoteId,date:day,totalCents:cents(row.TotalAmt),reversed:false,allocations})
    }
   }
   if(rows.length<100)break
   if(start===10001)fail('ACCOUNTING_DATA','Narrow the accounting period. No truncated selection was saved.',502)
  }
 }
 return result
}
