import type { Bindings } from '../auth.server'
import { observeOperation } from './connection-observations'
import { accountingRealm, total, type AccountingLink } from './accounting-records'
import { quickbooksRecords } from './accounting-quickbooks'
import { pantryRecords } from './accounting-pantry'
import { netsuiteRecords } from './accounting-netsuite'

export async function accountingRecords(env:Bindings,link:AccountingLink,since:string,through:string){
 const realmId=accountingRealm(env,link.provider),account=link.provider==='pantry'?realmId.slice(7):link.provider==='netsuite'?realmId.slice(9):realmId
 try{
  const records=await (link.provider==='pantry'?pantryRecords:link.provider==='netsuite'?netsuiteRecords:quickbooksRecords)(env,link,since,through)
  const totalCents=total([...records.bills,...records.invoices].map(d=>d.totalCents)),paymentTotalCents=total(records.payments.filter(p=>!p.reversed).map(p=>p.totalCents))
  await observeOperation(env,link.provider,account,true,'accounting_read_succeeded')
  return {provider:link.provider,realmId,vendorId:link.vendor_id,counterpartyKind:link.record_kind,direction:link.record_kind==='customer'?'revenue':'spend',since,through,...records,totalCents,paymentTotalCents,asOf:Date.now(),basis:'USD linked-counterparty documents and separately recorded payments. Drafts and reversed payments are excluded from totals. Contract allocation is unconfirmed; invoice revenue is billed, not recognized revenue. Payment totals do not prove settlement against this contract.'}
 }catch(error){await observeOperation(env,link.provider,account,false,(error as {code?:string}).code==='ACCOUNTING_DATA'?'invalid_provider_receipt':'accounting_read_failed');throw error}
}
