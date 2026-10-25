// Read-only QuickBooks Online adapter. An owner explicitly links the vendor;
// server credentials never enter commands, state, audit or the complete archive.
import { observeOperation } from './connection-observations'
import type { Bindings } from '../auth.server'
import { may, requireRole } from './access'
import type { Handler } from './commands'
import { fail, sql, text } from './model'
import { agreementGuards, bump, visibleAgreement } from './records'

async function readAccountingSpend(env: Bindings, vendorId: string, since: string, through: string) {
 if (!env.QUICKBOOKS_ACCESS_TOKEN || !env.QUICKBOOKS_REALM_ID || !/^\d+$/.test(env.QUICKBOOKS_REALM_ID)) fail('ACCOUNTING_UNAVAILABLE','Configure the server-only QuickBooks connection before reading spend.',409)
 const host=env.QUICKBOOKS_SANDBOX==='true'?'sandbox-quickbooks.api.intuit.com':'quickbooks.api.intuit.com'
 const bills:{id:string;date:string;totalCents:number;balanceCents:number}[]=[]
 for(let start=1;start<=10001;start+=100) {
  const query=`SELECT * FROM Bill WHERE VendorRef = '${vendorId}' AND TxnDate >= '${since}' AND TxnDate <= '${through}' STARTPOSITION ${start} MAXRESULTS 100`
  let response:Response
  try {response=await fetch(`https://${host}/v3/company/${env.QUICKBOOKS_REALM_ID}/query?query=${encodeURIComponent(query)}&minorversion=75`,{headers:{Authorization:`Bearer ${env.QUICKBOOKS_ACCESS_TOKEN}`,Accept:'application/json'},signal:AbortSignal.timeout(15000)})}
  catch {fail('ACCOUNTING_UNAVAILABLE','QuickBooks could not be reached. Spend is unavailable, never assumed to be zero.',502)}
  if(!response.ok) fail('ACCOUNTING_UNAVAILABLE','QuickBooks refused the read. Reconnect or retry; spend is unavailable.',502)
  const raw:any=await response.json().catch(()=>null), rows=raw?.QueryResponse?.Bill??(raw?.QueryResponse?[]:null)
  if(!Array.isArray(rows)||rows.length>100) fail('ACCOUNTING_DATA','QuickBooks returned an invalid bill page.',502)
  for(const b of rows) {
   const cents=(value:unknown)=>{const n=typeof value==='number'?value:NaN;const out=Math.round(n*100);if(!Number.isSafeInteger(out)||out<0||Math.abs(n*100-out)>0.00001)fail('ACCOUNTING_DATA','QuickBooks returned an invalid USD amount.',502);return out}
   if(typeof b.Id!=='string'||b.VendorRef?.value!==vendorId||!/^\d{4}-\d{2}-\d{2}$/.test(b.TxnDate)||b.TxnDate<since||b.TxnDate>through||b.CurrencyRef?.value!=='USD'||bills.some(x=>x.id===b.Id))fail('ACCOUNTING_DATA','QuickBooks bill identity, vendor, date or USD currency did not match the linked read.',502)
   bills.push({id:b.Id,date:b.TxnDate,totalCents:cents(b.TotalAmt),balanceCents:cents(b.Balance)})
  }
  if(rows.length<100) {
   const totalCents=bills.reduce((n,b)=>n+b.totalCents,0)
   if(!Number.isSafeInteger(totalCents))fail('ACCOUNTING_DATA','Spend exceeds the supported exact USD range.',502)
   return {provider:'QuickBooks Online',vendorId,since,through,bills,totalCents,asOf:Date.now(),basis:'USD bills incurred in the linked vendor period; balances are outstanding, not additional spend. No allocation across contracts is inferred.'}
  }
 }
 fail('ACCOUNTING_DATA','The bill selection exceeds 10,000 records. Narrow the agreement period; no partial total was saved.',502)
}
const link:Handler=async(c,p)=>{
 requireRole(c.actor,may.manageRoles,'connect a QuickBooks vendor')
 const a=await visibleAgreement(c,p.agreementId),vendorId=text(p,'vendorId',40)
 if(a.type!=='supplier'||!/^\d+$/.test(vendorId)||p.consent!==true)fail('INVALID','Select a supplier vendor id and explicitly authorize reading its USD bills into this agreement brief.')
 return {allowed:may.manageRoles,result:{agreementId:a.id},checks:agreementGuards(c,a,p),writes:[sql('INSERT INTO lk_accounting_links VALUES(?,?,?,?,1) ON CONFLICT(agreement_id) DO UPDATE SET vendor_id=excluded.vendor_id,linked_by=excluded.linked_by,linked_at=excluded.linked_at,version=lk_accounting_links.version+1',a.id,vendorId,c.actor.id,c.now),bump(c,a)],audit:[{action:'accounting.link',agreementId:a.id,summary:'Owner authorized a read-only QuickBooks vendor link and USD bills in this agreement’s renewal brief.'}]}
}
export const accountingHandlers={'accounting.link':link}

export async function accountingSpend(env:Bindings,vendorId:string,since:string,through:string){
 try{
  const spend=await readAccountingSpend(env,vendorId,since,through)
  await observeOperation(env,'quickbooks',env.QUICKBOOKS_REALM_ID!,true,'accounting_read_succeeded')
  return spend
 }catch(error){
  if(env.QUICKBOOKS_REALM_ID)await observeOperation(env,'quickbooks',env.QUICKBOOKS_REALM_ID,false,(error as {code?:string}).code==='ACCOUNTING_DATA'?'invalid_provider_receipt':'accounting_read_failed')
  throw error
 }
}
