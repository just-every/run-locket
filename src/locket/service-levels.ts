import { may,requireRole } from './access'
import { storeArtifact } from './artifacts'
import type { Handler } from './commands'
import { refuseErasedAddress } from './erasure-addresses'
import { canonical,fail,integer,json,money,Problem,sha256,sql,text,timezone } from './model'
import { notificationWrites } from './notifications'
import { citation } from './obligations'
import { agreementGuards,bump,visibleAgreement } from './records'
import { readUptime,serviceMonth,uptimeDenominatorPolicy,uptimeOrigin } from './service-level-evidence'
import { serviceLink,servicePeople,servicePerson,serviceReaders,serviceSources,serviceTerm } from './service-level-records'
import { serviceClaimHandlers } from './service-level-claims'
import { serviceMailHandlers } from './service-level-mail'

const link:Handler=async(c,p)=>{
 requireRole(c.actor,may.manageRoles,'authorize Uptime monitoring evidence')
 const a=await visibleAgreement(c,p.agreementId),origin=uptimeOrigin(p.origin),monitorId=text(p,'monitorId',512)
 if(a.type!=='supplier'||!['executed','imported'].includes(a.status))fail('NOT_EXECUTED','Connect monitoring only to an executed or imported supplier agreement.',409)
 if(origin!==uptimeOrigin(c.env.UPTIME_ORIGIN)||!c.env.UPTIME_METRICS_KEY)fail('UPTIME_CONFIG','Configure the server-only metrics key for this exact Uptime installation first.',409)
 if(p.consent!==true||/[\x00-\x20,\x7f]/.test(monitorId))fail('CONSENT','Explicitly authorize the exact Uptime installation and one monitor identifier.')
 return {allowed:may.manageRoles,result:{agreementId:a.id},checks:agreementGuards(c,a,p),writes:[sql('INSERT INTO lk_service_level_links(id,agreement_id,origin,monitor_id,consent_by,consent_at,version) VALUES(?,?,?,?,?,?,1) ON CONFLICT(agreement_id) DO UPDATE SET origin=excluded.origin,monitor_id=excluded.monitor_id,consent_by=excluded.consent_by,consent_at=excluded.consent_at,version=lk_service_level_links.version+1,last_error=NULL',crypto.randomUUID(),a.id,origin,monitorId,c.actor.id,c.now),bump(c,a)],audit:[{action:'service-level.link',agreementId:a.id,summary:'Installation owner explicitly authorized read-only metrics from the exact Uptime installation and monitor. No supplier contact authorized.'}]}
}
const confirm:Handler=async(c,p)=>{
 requireRole(c.actor,['counsel'],'confirm the signed service-credit formula')
 const a=await visibleAgreement(c,p.agreementId),link=await serviceLink(c,a.id),family=await serviceSources(c,a),source=family.rows.find(a=>a.id===text(p,'sourceAgreementId',100))
 if(!['executed','imported'].includes(a.status))fail('NOT_EXECUTED','Confirm service levels only on an executed or imported supplier agreement.',409)
 if(!source||!['executed','imported'].includes(source.status))fail('CITATION','Choose an executed source in the agreement’s amendment family.')
 const target=integer(p,'targetBps',1,10000),floor=integer(p,'tierFloorBps',0,9999),credit=integer(p,'creditBps',1,10000),monthly=money(p,'monthlyBasis'),zone=timezone(p,'timeZone'),days=integer(p,'claimDays',1,365),interpretation=text(p,'interpretation',4000)
 if(floor>=target||!monthly||p.denominatorPolicy!==uptimeDenominatorPolicy||p.confirmExclusions!==true||p.confirmFormula!==true)fail('SLA_FORMULA','Confirm the monthly USD basis, one exact credit tier, observed-time denominator and exclusions, and the local calendar-day claim formula.')
 const cite=await citation(c,source,p.citation),id=crypto.randomUUID(),prior=await c.db.prepare('SELECT id FROM lk_service_level_terms WHERE agreement_id=? ORDER BY rowid DESC LIMIT 1').bind(a.id).first<{id:string}>(),person=await servicePerson(c,a.owner_id,servicePeople,family.sources.map(s=>s.id))
 const erased=await refuseErasedAddress(c,'request.create',p)
 return {allowed:['counsel'],result:{id},checks:[...agreementGuards(c,a,p),...family.checks,person.check,...erased,sql('(SELECT version FROM lk_service_level_links WHERE agreement_id=?)=?',a.id,link.version),sql('(SELECT id FROM lk_service_level_terms WHERE agreement_id=? ORDER BY rowid DESC LIMIT 1) IS ?',a.id,prior?.id??null)],writes:[sql('INSERT INTO lk_service_level_terms VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,a.id,link.version,source.id,json(family.sources),json(cite),target,floor,credit,monthly,zone,days,uptimeDenominatorPolicy,interpretation,c.actor.id,c.now)],audit:[{action:'service-level.confirm',agreementId:a.id,summary:'Counsel confirmed the executed SLA citation, exact monthly credit tier and USD basis, observed-time exclusions, service zone and end-of-month plus calendar-days claim deadline.'}]}
}
const read:Handler=async(c,p)=>{
 requireRole(c.actor,serviceReaders,'compare authorized monitoring evidence')
 const a=await visibleAgreement(c,p.agreementId),current=await serviceTerm(c,a),{term,link}=current,period=serviceMonth(p.month,term.timezone,term.claim_days)
 if(period.to>c.now)fail('PERIOD_OPEN','Read a completed calendar service month; partial-month availability cannot establish this claim.',409)
 if(c.now>=period.deadlineAt)fail('CLAIM_CLOSED','The confirmed claim window has closed. No new claim is prepared.',409)
 let evidence:Awaited<ReturnType<typeof readUptime>>
 try{evidence=await readUptime(c.env,link.origin,link.monitor_id,period,c.now)}catch(error){
  if(!(error instanceof Problem))throw error
  return {allowed:serviceReaders,result:{status:'unavailable',code:error.code},checks:current.checks,writes:[sql('UPDATE lk_service_level_links SET last_error=? WHERE id=?',`${error.code}: ${error.message}`,link.id)],audit:[{action:'service-level.read.unavailable',agreementId:a.id,summary:'Monitoring evidence unavailable; no zero availability, supplier breach or credit was inferred. Connection error retained for review.'}]}
 }
 if(Date.now()>=period.deadlineAt)fail('CLAIM_CLOSED','The claim window closed while reading monitoring evidence. No claim was prepared.',409)
 const id=crypto.randomUUID(),m=evidence.metrics
 const artifact=await storeArtifact({filename:`uptime-${period.month}-${id}.json`,mediaType:'application/json',bytes:evidence.bytes},{agreementId:a.id,role:'attachment',actorId:c.actor.id,at:c.now,provenance:{kind:'service_level_evidence',readId:id,sources:JSON.parse(term.sources),origin:link.origin,monitorId:link.monitor_id,from:period.from,to:period.to}})
 const writes=[...artifact.writes,sql('INSERT INTO lk_service_level_reads VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,a.id,term.id,link.version,term.sources,period.month,period.from,period.to,artifact.id,evidence.sha256,json(m),c.now),sql('UPDATE lk_service_level_links SET last_error=NULL WHERE id=?',link.id)]
 const up=BigInt(m.upMs),observed=BigInt(m.observedMs),miss=up*10000n<observed*BigInt(term.target_bps),inTier=up*10000n>=observed*BigInt(term.tier_floor_bps)
 if(!miss)return {allowed:serviceReaders,result:{id,status:'met'},checks:current.checks,writes,audit:[{action:'service-level.read.met',agreementId:a.id,summary:'Preserved exact Uptime response bytes, digest and complete calendar bounds; the exact observed fraction meets the confirmed commitment.'}]}
 if(!inTier)return {allowed:serviceReaders,result:{id,status:'unavailable',code:'SLA_TIER'},checks:current.checks,writes:[...writes,sql('UPDATE lk_service_level_links SET last_error=? WHERE id=?','SLA_TIER: Availability is below the counsel-confirmed tier. Confirm the applicable signed credit tier before claiming.',link.id)],audit:[{action:'service-level.read.tier',agreementId:a.id,summary:'Preserved below-commitment monitoring evidence; no amount inferred outside the counsel-confirmed credit tier.'}]}
 const amount=Number((BigInt(term.monthly_cents)*BigInt(term.credit_bps)+5000n)/10000n)
 if(!Number.isSafeInteger(amount)||amount<=0)fail('SLA_FORMULA','The credit formula is outside the supported exact USD range.',409)
 const fingerprint=await sha256(canonical({agreementId:a.id,termId:term.id,linkVersion:link.version,month:period.month,monitorId:link.monitor_id,metrics:{...m,generatedAt:undefined}})),prior=await c.db.prepare('SELECT id FROM lk_service_level_claims WHERE fingerprint=?').bind(fingerprint).first<{id:string}>()
 if(prior)return {allowed:serviceReaders,result:{id,claimId:prior.id,status:'breached'},checks:current.checks,writes,audit:[{action:'service-level.read',agreementId:a.id,summary:'Preserved a fresh exact monitoring response; unchanged supplier-breach evidence reused the existing claim.'}]}
 const claimId=crypto.randomUUID(),obligationId=crypto.randomUUID(),observedPercent=Number(up*1000000n/observed)/10000
 const content={citation:JSON.parse(term.citation),sourceAgreementId:term.source_agreement_id,interpretation:term.interpretation,metrics:m,period:{from:period.from,to:period.to,timeZone:term.timezone},formula:{targetBps:term.target_bps,tierFloorBps:term.tier_floor_bps,creditBps:term.credit_bps,monthlyCents:term.monthly_cents,amountCents:amount,claimDays:term.claim_days,deadlineRule:'Final service date plus calendar days, at 23:59:59 in the confirmed zone'},responseSha256:evidence.sha256,artifactId:artifact.id,supplierPartyId:a.party_id,observedPercent}
 const subject=`Service credit claim: ${a.reference}, ${period.month}`,message=`Please review our USD ${(amount/100).toFixed(2)} service-credit claim for ${period.month}. Uptime monitor ${link.monitor_id} recorded ${m.upMs} healthy milliseconds out of ${m.observedMs} observed scheduled milliseconds (${observedPercent}% availability). The signed commitment is ${term.target_bps/100}%; the applicable credit tier is ${term.credit_bps/100}% of USD ${(term.monthly_cents/100).toFixed(2)}.\n\nClause: “${content.citation.quote}”\nInterpretation: ${term.interpretation}\nMonitoring evidence SHA-256: ${evidence.sha256}\nClaim deadline: ${new Date(period.deadlineAt).toISOString()} (${term.timezone}).\n\nPlease confirm the credit or explain any disagreement. This request does not establish credit recovery.`
 writes.push(sql("INSERT INTO lk_obligations(id,agreement_id,description,owner_id,due_date,recurrence,citation,status,created_by,confirmed_by,created_at,evidence,risk,evidence_note) VALUES(?,?,?,?,?,'none',?,'confirmed',?,?,?,'note','high',?)",obligationId,a.id,`Follow up supplier monthly availability breach (${period.month}) and review USD ${(amount/100).toFixed(2)} credit claim`,a.owner_id,period.deadlineDate,json(content.citation),c.actor.id,term.confirmed_by,c.now,`Supplier commitment breached; exact monitoring evidence ${evidence.sha256}. Claim requires agreement-owner approval.`),sql("INSERT INTO lk_service_level_claims(id,agreement_id,read_id,fingerprint,sources,monitor_id,month,amount_cents,deadline_at,deadline_date,content,owner_id,obligation_id,subject,message_text,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'proposed',?)",claimId,a.id,id,fingerprint,term.sources,link.monitor_id,period.month,amount,period.deadlineAt,period.deadlineDate,json(content),a.owner_id,obligationId,subject,message,c.now),sql("INSERT INTO lk_service_level_breaches VALUES(?,?,?,?,?,?,'breached',?,?,?)",crypto.randomUUID(),a.id,claimId,a.party_id,obligationId,id,period.from,period.to,c.now),...notificationWrites(c,{key:claimId,agreementId:a.id,recipientId:a.owner_id,kind:'obligation'}))
 return {allowed:serviceReaders,result:{id,claimId,status:'breached',amountCents:amount},checks:[...current.checks,sql('NOT EXISTS(SELECT 1 FROM lk_service_level_claims WHERE fingerprint=?)',fingerprint)],writes,audit:[{action:'service-level.breach',agreementId:a.id,summary:`Recorded a supplier SLA breach with exact monitoring bytes and a proposed USD ${(amount/100).toFixed(2)} credit. Claim deadline recorded; no supplier message sent.`}]}
}
export const serviceLevelHandlers={'service-level.link':link,'service-level.confirm':confirm,'service-level.read':read,...serviceClaimHandlers,...serviceMailHandlers}
