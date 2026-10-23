import { serviceLevelFixture } from './service-level-fixture.mjs'

export const servicePerformanceBindings={MAIL_PROVIDER:'resend',MAIL_API_KEY:'synthetic-locket-2',TEST_NOW:String(Date.parse('2026-10-17T14:00:00Z'))}
export function serviceReportFile(records) {
 const fields=['record_id','created_at','first_public_response_at','resolved_at','due_at','delivered_at'],quote=value=>'"'+String(value??'').replaceAll('"','""')+'"'
 const body=fields.join(',')+'\r\n'+records.map(record=>fields.map(key=>quote(record[key])).join(',')).join('\r\n')+'\r\n'
 return {filename:'synthetic-locket-performance.csv',mediaType:'text/csv',base64:Buffer.from(body).toString('base64')}
}
export async function servicePerformanceFixture(h,{metric='response',confirm=true,native=true,records:provided,restricted=false}={}) {
 // Existing fixture supplies a genuine native executed supplier agreement and
 // active counsel; no Uptime authorization or monitoring terms are inserted.
 const quote='Supplier must first respond within 60 wall-clock minutes and resolve within 60 wall-clock minutes after creation. Delivery must occur by the recorded due instant. Each metric earns one monthly credit selected by worst proven lateness: more than zero minutes late earns 10 percent and more than 60 minutes late earns 20 percent of the USD 10000 eligible hosting fee, capped at USD 1500. Fees exclude tax and unrelated services. Unknown timestamps and closure alone do not prove fulfillment. Service months use UTC and claims are due 30 calendar days after month end.'
 const base=await serviceLevelFixture(h,{confirm:false,link:false,native,restricted,extraText:quote})
 const records=provided??[
  {record_id:'synthetic-locket-late',created_at:'2026-09-10T00:00:00Z',first_public_response_at:'2026-09-10T03:00:00Z',resolved_at:'2026-09-10T03:00:00Z',due_at:'2026-09-10T01:00:00Z',delivered_at:'2026-09-10T03:00:00Z'},
  {record_id:'synthetic-locket-unknown',created_at:'2026-09-11T00:00:00Z',first_public_response_at:'',resolved_at:'',due_at:'2026-09-11T01:00:00Z',delivered_at:''}
 ]
 const reportFile=serviceReportFile(records)
 const confirmPayload=async()=>({agreementId:base.source.id,version:(await base.current()).version,sourceAgreementId:base.source.id,citation:{quote},metric,clock:'wall',aggregation:'worst_record_once',thresholdMinutes:metric==='delivery'?0:60,tiers:[{minimumLateMinutes:0,creditBps:1000},{minimumLateMinutes:60,creditBps:2000}],eligibleFee:'10000',allocation:'USD 10000 hosting fee only; taxes and unrelated service charges excluded.',cap:'1500',timeZone:'UTC',claimDays:30,interpretation:'One monthly credit per metric uses the worst proven lateness from the attributed report. Exact wall-clock UTC timestamps only, no business calendar, no event stacking; missing completion stays unknown.',confirmFormula:true})
 let termId
 if(confirm)termId=(await base.counsel.command('service-performance.confirm',await confirmPayload())).id
 const reportPayload=async()=>({agreementId:base.source.id,termId:termId??(await h.owner.state()).serviceLevels.performanceTerms.find(t=>t.agreement_id===base.source.id&&t.metric===metric)?.id,month:'2026-09',file:reportFile,sourceName:'Supplier September performance report',sourceReference:'synthetic-locket-september-report',windowNote:'September 2026 created records for response/resolution; September due records for delivery. Supplier completeness and authenticity unverified.',consent:true})
 const read=async(changes={})=>h.owner.command('service-performance.report',{...await reportPayload(),...changes})
 const claim=async id=>(await h.owner.state()).serviceLevels.performanceClaims.find(c=>c.id===id)
 const save=async id=>{const c=await claim(id);return h.owner.command('service-level.message',{claimId:id,claimVersion:c.version,recipient:'synthetic-locket-supplier@example.test',subject:c.subject,message:c.message_text})}
 const sendPayload=async id=>{const c=await claim(id);return {claimId:id,claimVersion:c.version,amountCents:c.amount_cents,messageDigest:c.message_digest,consent:true}}
 const approve=async id=>h.owner.command('service-level.approve',await sendPayload(id))
 return {...base,quote,metric,records,reportFile,confirmPayload,reportPayload,read,claim,save,approve,sendPayload}
}
