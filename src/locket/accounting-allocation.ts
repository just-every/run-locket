// Vendor totals remain unallocated until an owner confirms exact transaction amounts.
import { may, requireRole } from './access'
import { accountingSpend } from './accounting'
import type { Handler } from './commands'
import { date, fail, json, list, money, object, sql, text, type Sql } from './model'
import { agreementGuards, bump, visibleAgreement } from './records'

const read:Handler=async(c,p)=>{
 requireRole(c.actor,may.manageRoles,'read accounting evidence for allocation')
 const a=await visibleAgreement(c,p.agreementId)
 if(a.type!=='supplier'||!['executed','imported'].includes(a.status))fail('NOT_EXECUTED','Read bills against an executed supplier agreement.',409)
 const link=await c.db.prepare('SELECT * FROM lk_accounting_links WHERE agreement_id=?').bind(a.id).first<any>()
 if(!link)fail('ACCOUNTING_LINK','The owner must authorize a QuickBooks vendor link first.',409)
 const since=date(p,'since'),through=date(p,'through')
 if(since>through)fail('INVALID','The accounting period end cannot precede its start.')
 const content=await accountingSpend(c.env,link.vendor_id,since,through),id=crypto.randomUUID()
 return {allowed:may.manageRoles,result:{id},checks:[...agreementGuards(c,a,p),sql('(SELECT version FROM lk_accounting_links WHERE agreement_id=?)=?',a.id,link.version)],writes:[sql('INSERT INTO lk_accounting_reads VALUES(?,?,?,?,?,?,?,?)',id,a.id,a.version,link.version,c.env.QUICKBOOKS_REALM_ID!,json(content),c.actor.id,c.now)],audit:[{action:'accounting.read',agreementId:a.id,summary:'Read exact vendor-period USD bills into an immutable allocation snapshot. Vendor-wide totals are not contract consumption.'}]}
}
const allocate:Handler=async(c,p)=>{
 requireRole(c.actor,may.manageRoles,'confirm contract allocation')
 const a=await visibleAgreement(c,p.agreementId),read=await c.db.prepare('SELECT * FROM lk_accounting_reads WHERE id=? AND agreement_id=?').bind(text(p,'readId',100),a.id).first<any>()
 if(!read)fail('NOT_FOUND','No accounting snapshot belongs to that agreement.',404)
 const link=await c.db.prepare('SELECT * FROM lk_accounting_links WHERE agreement_id=?').bind(a.id).first<any>()
 if(a.version!==read.agreement_version||link?.version!==read.link_version||c.env.QUICKBOOKS_REALM_ID!==read.realm_id)fail('STALE','The agreement or accounting link changed. Read and review a fresh snapshot.',409)
 if(p.confirmAllocation!==true)fail('CONSENT','Confirm which exact transaction amounts belong to this contract.')
 const spend=JSON.parse(read.content),seen=new Set<string>(),selected=list(p,'allocations',10000).map(value=>{
  const item=object(value),billId=text(item,'billId',100),bill=spend.bills.find((b:any)=>b.id===billId),amount=money(item,'amount')
  if(!bill||seen.has(billId)||amount===null||amount<=0||amount>bill.totalCents)fail('ALLOCATION','Each selected bill needs one positive allocation no larger than its retained total.')
  seen.add(billId);return {billId,amount,total:bill.totalCents}
 })
 if(!selected.length)fail('ALLOCATION','Select at least one exact bill amount.')
 const checks:Sql[]=[...agreementGuards(c,a,p),sql('(SELECT version FROM lk_accounting_links WHERE agreement_id=?)=?',a.id,link.version)]
 // Other contracts sharing the same vendor cannot consume the same cents twice.
 for(const item of selected)checks.push(sql('COALESCE((SELECT SUM(amount_cents) FROM lk_accounting_allocations WHERE realm_id=? AND vendor_id=? AND bill_id=? AND agreement_id<>? AND active=1),0)+?<=?',read.realm_id,spend.vendorId,item.billId,a.id,item.amount,item.total))
 const writes=[sql('UPDATE lk_accounting_allocations SET active=0 WHERE agreement_id=?',a.id),...selected.map(item=>sql('INSERT INTO lk_accounting_allocations VALUES(?,?,?,?,?,?,?,?,?,?,?)',crypto.randomUUID(),a.id,read.id,item.billId,read.realm_id,spend.vendorId,item.amount,1,a.version+1,c.actor.id,c.now)),bump(c,a)]
 return {allowed:may.manageRoles,result:{readId:read.id},checks,writes,audit:[{action:'accounting.allocate',agreementId:a.id,summary:'Owner explicitly confirmed exact USD bill amounts attributable to this contract; retained vendor-wide totals remain separate.'}]}
}
export const accountingAllocationHandlers={'accounting.read':read,'accounting.allocate':allocate}
