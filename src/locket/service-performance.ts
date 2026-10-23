import { performanceTickets } from './service-performance-tickets'
import { requireRole } from './access'
import { fileInput } from './artifacts'
import type { Handler } from './commands'
import { fail,integer,json,list,money,object,sql,text,timezone } from './model'
import { citation } from './obligations'
import { agreementGuards,visibleAgreement } from './records'
import { servicePeople,servicePerson,serviceSources } from './service-level-records'
import { performanceCsv,type PerformanceConfig,type PerformanceMetric } from './service-performance-evidence'
import { recordPerformance } from './service-performance-report'

const confirm:Handler=async(c,p)=>{
 requireRole(c.actor,['counsel'],'confirm signed supplier performance and credit terms')
 const a=await visibleAgreement(c,p.agreementId),family=await serviceSources(c,a),source=family.rows.find(s=>s.id===text(p,'sourceAgreementId',100))
 if(a.type!=='supplier'||!['executed','imported'].includes(a.status))fail('NOT_EXECUTED','Confirm performance only for an executed or imported supplier agreement.',409)
 if(!source||!['executed','imported'].includes(source.status))fail('CITATION','Select an executed source in this amendment family.')
 if(!['response','resolution','delivery'].includes(String(p.metric)))fail('SLA_FORMULA','Choose response, resolution or delivery.')
 const metric=p.metric as PerformanceMetric,thresholdMinutes=integer(p,'thresholdMinutes',0,525600)
 if(p.clock!=='wall'||p.aggregation!=='worst_record_once'||(metric==='delivery'?thresholdMinutes!==0:thresholdMinutes<1))fail('SLA_CLOCK','Only explicitly confirmed wall-clock commitments and one worst-record monthly credit are supported. Business calendars and stacking are not inferred.')
 const tiers=list(p,'tiers',20).map(value=>{const tier=object(value);return {minimumLateMinutes:integer(tier,'minimumLateMinutes',0,5256000),creditBps:integer(tier,'creditBps',1,10000)}})
 if(!tiers.length||tiers[0].minimumLateMinutes!==0||tiers.some((t,i)=>i>0&&(t.minimumLateMinutes<=tiers[i-1].minimumLateMinutes||t.creditBps<tiers[i-1].creditBps)))fail('SLA_FORMULA','Supply ascending lateness tiers beginning at zero with nondecreasing credit percentages.')
 const eligibleFeeCents=money(p,'eligibleFee'),capCents=money(p,'cap')
 if(!eligibleFeeCents||!capCents||p.confirmFormula!==true)fail('SLA_FORMULA','Explicitly confirm the eligible USD fee allocation, credit cap, tiers and deadline against the signed text.')
 const config:PerformanceConfig={clock:'wall',aggregation:'worst_record_once',thresholdMinutes,tiers,eligibleFeeCents,allocation:text(p,'allocation',4000),capCents,timeZone:timezone(p,'timeZone'),claimDays:integer(p,'claimDays',1,365),interpretation:text(p,'interpretation',4000)}
 const cite=await citation(c,source,p.citation),owner=await servicePerson(c,a.owner_id,servicePeople,family.sources.map(s=>s.id)),id=crypto.randomUUID(),prior=await c.db.prepare('SELECT id FROM lk_service_performance_terms WHERE agreement_id=? AND metric=? ORDER BY rowid DESC LIMIT 1').bind(a.id,metric).first<{id:string}>()
 return {allowed:['counsel'],result:{id},checks:[...agreementGuards(c,a,p),...family.checks,owner.check,sql('(SELECT id FROM lk_service_performance_terms WHERE agreement_id=? AND metric=? ORDER BY rowid DESC LIMIT 1) IS ?',a.id,metric,prior?.id??null)],writes:[sql('INSERT INTO lk_service_performance_terms VALUES(?,?,?,?,?,?,?,?,?)',id,a.id,metric,source.id,json(family.sources),json(cite),json(config),c.actor.id,c.now)],audit:[{action:'service-performance.confirm',agreementId:a.id,summary:'Counsel confirmed an exact signed wall-clock supplier commitment, worst-record monthly tiers, allocated eligible USD fee, cap, service zone and claim deadline. Business calendars and fulfillment are not inferred.'}]}
}
const report:Handler=async(c,p)=>{
 requireRole(c.actor,servicePeople,'authorize supplier report evidence')
 const file=fileInput(p.file,'file')
 if(file.mediaType!=='text/csv'||!file.filename.toLowerCase().endsWith('.csv'))fail('REPORT_DATA','Upload the documented supplier CSV report as text/csv.')
 return recordPerformance(c,p,{file,records:performanceCsv(file.bytes),kind:'supplier_report',sourceName:text(p,'sourceName',200),sourceReference:text(p,'sourceReference',1000),windowNote:text(p,'windowNote',4000),warnings:['Supplier-provided report; authenticity and completeness are not independently verified. Missing events stay unknown.'],connection:{}})
}
export const servicePerformanceHandlers={'service-performance.confirm':confirm,'service-performance.report':report,'service-performance.tickets':performanceTickets}
