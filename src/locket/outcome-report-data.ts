import type { Bindings } from '../auth.server'
import { agreementAccessSql, may, requireRole } from './access'
import { accountingSpend } from './accounting'
import { canReadServiceSources } from './service-level-records'
import { requireFullFields } from './repository-access'
import { lifecycle } from './lifecycle'
import { familyClear } from './family-analysis-guard'
import { zonedInstant, addDays } from './dates'
import { installationSettings } from './installation'
import type { Actor, Sql } from './model'
import type { AgreementRow } from './records'
import { addFigure, emptyMonth, evidence, monthBounds, outcomeMonth, shiftMonth, type OutcomeReport } from './outcome-report-model'

type Row={id:string;[key:string]:any}
export type AccountingSelection={agreementId:string;version:number;vendorId:string}
export async function buildOutcomeReport(env:Bindings,actor:Actor,month:string,selected:AccountingSelection[],now=Date.now()){
 requireRole(actor,may.read,'read monthly outcomes');await requireFullFields(env.DB,actor);outcomeMonth(month)
 const settings=await installationSettings(env.DB),db=env.DB,access=agreementAccessSql(actor.id)
 const queries=['SELECT a.* FROM lk_agreements a WHERE '+access.sql,
  'SELECT * FROM lk_obligations', 'SELECT * FROM lk_renewal_history','SELECT * FROM lk_renewals','SELECT * FROM lk_terms',
  'SELECT * FROM lk_service_level_claims','SELECT * FROM lk_service_performance_claims',
  "SELECT f.*,s.sources FROM lk_reconciliation_findings f JOIN lk_reconciliation_scans s ON s.id=f.scan_id WHERE f.status<>'rejected'",
  'SELECT * FROM lk_accounting_links','SELECT * FROM lk_notices']
 const result=await db.batch<Row>(queries.map((query,i)=>i===0?db.prepare(query).bind(...access.params):db.prepare(query)))
 const [agreements,obligations,history,renewals,terms,uptime,performance,findings,links,notices]=result.map(r=>r.results)
 const ids=new Set(agreements.map(a=>a.id)),byId=new Map(agreements.map(a=>[a.id,a]))
 const permitted=async(row:Row)=>ids.has(row.agreement_id)&&(!row.sources||await canReadServiceSources(db,actor,row.sources))
 const claims:Row[]=[],overcharges:Row[]=[],checks:Sql[]=[]
 for(const row of [...uptime,...performance])if(await permitted(row))claims.push(row)
 for(const row of findings)if(await permitted(row))overcharges.push(row)
 const report:OutcomeReport={month,timezone:settings.timezone,generatedAt:now,months:Array.from({length:12},(_,i)=>emptyMonth(shiftMonth(month,i-11))),basis:[
  'Months use the installation time zone; obligation due dates use the agreement time zone. Closed months are compared using currently retained records and current access, not frozen historical visibility.',
  'Missed deadlines are counted in their due month when not met by the due instant; late completions are counted in their completion month. Overdue counts are open at each month end. These measures overlap and must not be added together.',
  'Only committed live no-decision renewal history is counted; pre-Locket derived periods are excluded. Superseded generations remain attributed historical evidence.',
  'Obligation side is explicitly recorded. Unknown side remains unclassified. Deadline and renewal dollar impacts are unmeasured; agreement value is never assumed to be loss.',
  'Findings are potential overcharges, deduplicated by evidence key. Credits found are native source-backed claims. No recovery ledger exists: recovered amounts are unconfirmed.',
  'Past-end spend means incurred USD vendor bills after the confirmed effective end, not payment or waste. Only explicitly selected unique accounting links are read. Shared-vendor allocation and missing evidence are unavailable.'
 ]}
 if(!selected.some(s=>ids.has(s.agreementId)))for(const m of report.months){m.figures.pastEndSpend.count=null;m.figures.pastEndSpend.cents=null;m.figures.pastEndSpend.unavailable.push('No accounting sources are authorized and accessible; spend is unavailable.')}
 const first=report.months[0].month,allBounds=monthBounds(first,settings.timezone),lastBounds=monthBounds(month,settings.timezone)
 const instantMonth=(at:number)=>report.months.find(m=>{const b=monthBounds(m.month,settings.timezone);return at>=b.from&&at<b.to})
 for(const a of agreements){
  if(selected.some(s=>s.agreementId===a.id))continue
  const current=lifecycle(a,terms,renewals,notices,now,settings.rollNoticeDeadlines)
  if(current.end)for(const m of report.months)if(current.end<monthBounds(m.month,settings.timezone).end)m.figures.pastEndSpend.unavailable.push(`${a.id}: No accounting source was selected for this ended agreement; spend is unavailable.`)
 }
 for(const o of obligations){if(!ids.has(o.agreement_id)||!['confirmed','done'].includes(o.status)||!o.due_date)continue
  // Service follow-up obligations inherit the complete claim's source restrictions.
  const sourceClaim=[...uptime,...performance].find(c=>c.obligation_id===o.id)
  if(sourceClaim&&!await permitted(sourceClaim))continue
  const a=byId.get(o.agreement_id)!,due=zonedInstant(o.due_date,'23:59:59',a.timezone),done=o.status==='done'?o.done_at:null
  const record=evidence(a.id,o.id,'obligation',o.description,null,{dueDate:o.due_date,dueAt:due,doneAt:done,side:o.responsible_side,citation:JSON.parse(o.citation)})
  const dueMonth=instantMonth(due)
  if(due<now&&(done===null||done>due)&&dueMonth)addFigure(dueMonth,'deadlinesMissed',record)
  if(done!==null&&done>due){const m=instantMonth(done);if(m&&done<=now)addFigure(m,'deadlinesLate',record)}
  for(const m of report.months){const b=monthBounds(m.month,settings.timezone),cutoff=Math.min(b.to,now);if(o.created_at<cutoff&&due<cutoff&&(done===null||done>=cutoff))addFigure(m,o.responsible_side==='ours'?'overdueOurs':o.responsible_side==='supplier'?'overdueSupplier':'overdueUnclassified',record)}
 }
 const seenRenewals=new Set<string>()
 for(const h of [...history].sort((a,b)=>a.derived_at-b.derived_at||a.id.localeCompare(b.id))){
  if(!ids.has(h.agreement_id)||h.derived_at_import||!h.committed||h.deadline_at===null||h.deadline_at>=now)continue
  const key=`${h.agreement_id}:${h.deadline_at}`
  if(seenRenewals.has(key))continue
  seenRenewals.add(key)
  const m=instantMonth(h.deadline_at),e=evidence(h.agreement_id,h.id,'renewal-history','Committed renewal deadline',null,{...h,relatedHistoryIds:history.filter(other=>other.agreement_id===h.agreement_id&&other.deadline_at===h.deadline_at).map(other=>other.id)})
  if(m&&h.decision===null)addFigure(m,'renewedWithoutDecision',e)
  if(m&&(h.decision===null||h.decided_at>h.deadline_at))addFigure(m,'deadlinesMissed',e)
  if(h.decided_at!==null&&h.decided_at>h.deadline_at){const late=instantMonth(h.decided_at);if(late&&h.decided_at<=now)addFigure(late,'deadlinesLate',e)}
 }
 // Current fixed-term notice deadlines may not yet have a committed roll-forward.
 for(const r of renewals){if(!ids.has(r.agreement_id)||!r.deadline_at||r.deadline_at>=now||history.some(h=>h.agreement_id===r.agreement_id&&h.generation_id===r.generation_id&&h.term_number===r.term_number))continue
  const recorded=r.decided_at,missed=recorded===null||recorded>r.deadline_at,m=instantMonth(r.deadline_at)
  if(missed&&m)addFigure(m,'deadlinesMissed',evidence(r.agreement_id,r.id,'renewal','Notice decision deadline',null,{deadlineAt:r.deadline_at,decision:r.decision,decidedAt:recorded}))
  if(recorded!==null&&recorded>r.deadline_at&&recorded<=now){const late=instantMonth(recorded);if(late)addFigure(late,'deadlinesLate',evidence(r.agreement_id,r.id,'renewal','Late recorded renewal decision',null,{deadlineAt:r.deadline_at,decidedAt:recorded,decision:r.decision}))}
 }
 const seen=new Set<string>()
 for(const f of overcharges.sort((a,b)=>a.created_at-b.created_at||a.id.localeCompare(b.id))){if(seen.has(f.evidence_key))continue;seen.add(f.evidence_key);const m=instantMonth(f.created_at);if(m&&f.created_at<=now){const content=JSON.parse(f.content);addFigure(m,'overchargesFound',evidence(f.agreement_id,f.id,'reconciliation','Potential invoice overcharge',content.atStakeCents,{...content,status:f.status}))}}
 for(const c of claims){const m=instantMonth(c.created_at);if(m&&c.created_at<=now)addFigure(m,'creditsFound',evidence(c.agreement_id,c.id,'service-credit','Source-backed service credit found',c.amount_cents,{month:c.month,status:c.status,readId:c.read_id,content:JSON.parse(c.content)}))}
 for(const selection of selected){if(!ids.has(selection.agreementId))continue
  const a=byId.get(selection.agreementId)!,link=links.find(l=>l.agreement_id===a.id)
  const clear=familyClear(a.id)
  if(!(await db.prepare(`SELECT ${clear.sql} AS ok`).bind(...clear.params).first<{ok:number}>())?.ok){for(const m of report.months)m.figures.pastEndSpend.unavailable.push(`${a.id}: Confirmed agreement-family interpretation is unresolved.`);continue}
  checks.push(clear)
  const current=lifecycle(a,terms.filter(t=>t.agreement_id===a.id),renewals.filter(r=>r.agreement_id===a.id),notices.filter(n=>n.agreement_id===a.id),now,settings.rollNoticeDeadlines)
  const mark=(reason:string)=>{for(const m of report.months)m.figures.pastEndSpend.unavailable.push(`${a.id}: ${reason}`)}
  if(!link||link.version!==selection.version||link.vendor_id!==selection.vendorId){mark('Accounting consent changed; owner must select the current link again.');continue}
  if(links.filter(l=>l.vendor_id===link.vendor_id).length!==1){mark('Vendor is linked to multiple agreements; no contract allocation inferred.');continue}
  if(!current.end){mark('No confirmed effective end date.');continue}
  const since=[addDays(current.end,1),allBounds.start].sort().at(-1)!,through=lastBounds.end
  if(since>through)continue
  try{const spend=await accountingSpend(env,link.vendor_id,since,through)
   for(const bill of spend.bills){const m=report.months.find(m=>m.month===bill.date.slice(0,7));if(m)addFigure(m,'pastEndSpend',evidence(a.id,bill.id,'accounting-bill',`QuickBooks USD bill ${bill.id}`,bill.totalCents,{...bill,vendorId:link.vendor_id,endDate:current.end,asOf:spend.asOf,basis:spend.basis}))}
  }catch{mark('Complete USD accounting evidence unavailable; no zero spend inferred.')}
 }
 for(const m of report.months){const f=m.figures.pastEndSpend;if(f.unavailable.length&&f.evidence.length===0){f.count=null;f.cents=null}}
 return {report,agreements:agreements as AgreementRow[],checks,settingsVersion:settings.version}
}
