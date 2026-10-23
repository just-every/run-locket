import { useState } from 'react'
import { fileToPayload, type LocketState, type Row } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { can, parse, personName } from './format'
import { serviceSourceStale, serviceUsd } from './service-levels'
import { ServicePerformanceSettings } from './service-performance-settings'
import { ServicePerformanceClaim, ServicePerformanceComparison } from './service-performance-claim'

export interface ServicePerformanceWorkspace {
 performanceTerms: Row[]; performanceReports: Row[]; performanceClaims: Row[]; performanceBreaches: Row[]; performanceDispatches: Row[]
}
export type ServicePerformanceState = LocketState & {serviceLevels: LocketState['serviceLevels'] & ServicePerformanceWorkspace}
export type ServicePerformanceProps = {state:ServicePerformanceState; agreement:Row; locket:Locket}
export const performanceMetric:Record<string,string>={response:'Response time',resolution:'Resolution time',delivery:'Delivery deadline'}

/** Reported timestamps establish only the expressly confirmed wall-clock metric. */
export function ServicePerformance({state,agreement:a,locket}:ServicePerformanceProps) {
 const [result,setResult]=useState<{status:string;code?:string}|null>(null)
 const [selectedTerm,setSelectedTerm]=useState('')
 if(a.type!=='supplier'||!['executed','imported'].includes(a.status))return null
 const data=state.serviceLevels,terms=data.performanceTerms.filter(t=>t.agreement_id===a.id)
 const term=terms.find(t=>t.id===selectedTerm)??terms[0]
 const reports=data.performanceReports.filter(r=>r.agreement_id===a.id),claims=data.performanceClaims.filter(c=>c.agreement_id===a.id)
 const config=term?parse<any>(term.config):null
 const current=term&&terms.find(t=>t.metric===term.metric)?.id===term.id&&!serviceSourceStale(state,term.sources),owner=state.actor.id===a.owner_id&&can(state,'owner','approver')
 return <section className="lk-card lk-service-performance" aria-label="Supplier response and delivery performance" style={{minWidth:0,overflowWrap:'anywhere'}}>
  <style>{`.lk-service-performance button{white-space:normal;max-width:100%;line-height:1.3}.lk-service-performance .lk-form,.lk-service-performance .lk-form-actions,.lk-service-performance fieldset{min-width:0}.lk-service-performance blockquote{margin-inline:0;padding-inline:12px}.lk-service-performance input,.lk-service-performance select,.lk-service-performance textarea{max-width:100%;box-sizing:border-box}`}</style>
  <h3>Supplier response and delivery performance</h3>
  <p>Compare reported response, resolution or delivery timestamps with a counsel-confirmed signed commitment. The agreement owner authorizes each source upload, reviews any credit, and separately approves and sends the exact message.</p>
  <ServicePerformanceSettings state={state} agreement={a} locket={locket}/>
  {terms.length>0&&<Field label="Confirmed performance formula"><select value={term?.id??''} onChange={e=>{setSelectedTerm(e.target.value);setResult(null)}}>{terms.map(t=><option key={t.id} value={t.id}>{performanceMetric[t.metric]} · confirmed {new Date(t.confirmed_at).toLocaleString('en-US')}</option>)}</select></Field>}
  {term&&<article aria-label="Confirmed performance terms"><blockquote>{parse<any>(term.citation).quote}</blockquote><p>{performanceMetric[term.metric]} · Wall-clock elapsed time. {term.metric!=='delivery'&&<>Threshold: {config.thresholdMinutes} minutes.</>}</p><p>{config.interpretation}</p><p>Eligible monthly fee: {serviceUsd(config.eligibleFeeCents)} · Monthly cap: {serviceUsd(config.capCents)}.</p><p>Allocation: {config.allocation}</p><p>Credit tiers: {config.tiers.map((tier:any)=>`more than ${tier.minimumLateMinutes} minutes late → ${tier.creditBps/100}%`).join('; ')}. One monthly credit uses the worst proven lateness.</p><p>Service month: {config.timeZone} · Claim within {config.claimDays} calendar days after month end.</p><p>Confirmed by {personName(state,term.confirmed_by)}. <a href={`#agreement/${term.source_agreement_id}/terms`}>Signed performance clause source</a></p></article>}
  {!current&&<p role="status">Counsel must confirm the current signed sources and formula before a report can be compared.</p>}
  {current&&owner&&<details><summary>Upload authorized supplier performance report</summary><Form busy={locket.busy} submit="Compare authorized performance report" onSubmit={async data=>{
   const selected=data.get('report')
   if(!(selected instanceof File)||!selected.size)return
   const response=await locket.run('service-performance.report',{agreementId:a.id,termId:term.id,month:value(data,'month'),file:await fileToPayload(selected),sourceName:value(data,'sourceName'),sourceReference:value(data,'sourceReference'),windowNote:value(data,'windowNote'),consent:data.get('consent')==='on'})
   if(response)setResult({status:response.status,code:response.code})
  }}>
   <Field label="Performance service month" hint={`Completed calendar month in the confirmed ${config.timeZone} zone.`}><input name="month" type="month" required/></Field>
   <Field label="Performance source name"><input name="sourceName" required placeholder="Supplier support report"/></Field>
   <Field label="Performance source reference" hint="Identify the report's issuer, export or source location."><input name="sourceReference" required/></Field>
   <Field label="Performance report coverage" hint="Describe the covered service, records, period and any exclusions. Missing records remain unknown."><textarea name="windowNote" required rows={3}/></Field>
   <Field label="Supplier performance CSV" hint="CSV header: record_id,created_at,first_public_response_at,resolved_at,due_at,delivered_at. Timestamps must be UTC ISO; blank event fields stay unknown."><input name="report" type="file" accept=".csv,text/csv" required/></Field>
   <label className="lk-check"><input name="consent" type="checkbox" required/> I authorize using this exact supplier report and source for this agreement and service month.</label>
   <p>The original file and digest are retained. Reported resolution is a timestamp observation; it does not prove contractual fulfillment. Business-hour calendars and unstated formula meanings are not inferred.</p>
  </Form></details>}
  {current&&owner&&term.metric!=='delivery'&&<details><summary>Read authorized Linen ticket evidence</summary><Form busy={locket.busy} submit="Compare authorized Linen tickets" onSubmit={async data=>{
   const ids=(name:string)=>value(data,name).split(/\r?\n/).map(id=>id.trim()).filter(Boolean)
   const response=await locket.run('service-performance.tickets',{agreementId:a.id,termId:term.id,month:value(data,'month'),queueIds:ids('queueIds'),recordIds:ids('recordIds'),windowNote:value(data,'windowNote'),consent:data.get('consent')==='on'})
   if(response)setResult({status:response.status,code:response.code})
  }}>
   <Field label="Linen service month"><input name="month" type="month" required/></Field>
   <Field label="Authorized Linen queue IDs" hint="One exact queue ID per line, within the server connection's authorized scope."><textarea name="queueIds" required rows={3}/></Field>
   <Field label="Authorized Linen ticket IDs" hint="One exact ticket ID per line. Only these selected records are read."><textarea name="recordIds" required rows={4}/></Field>
   <Field label="Linen evidence coverage" hint="Identify the services and records selected, the reporting period, and any limits to completeness."><textarea name="windowNote" required rows={3}/></Field>
   <p>The connection uses the installation's configured Linen origin and read-only authorization. Unknown or business-hour timing stays unknown. Reported closure is not proof of fulfillment; delivery evidence requires a supplier report.</p>
   <label className="lk-check"><input name="consent" type="checkbox" required/> I authorize reading these exact Linen queues and tickets for this agreement and service month, and retaining the original evidence.</label>
  </Form></details>}
  {!owner&&<p>Only {personName(state,a.owner_id)}, the agreement owner holding owner or approver authority, may authorize a report, approve a credit or send its message.</p>}
  {result&&<p role="status">{result.status==='breached'?'A proven performance breach and proposed credit were recorded. Review the source, unknown records and claim below.':result.status==='met'?'The reported records meet the confirmed metric. No credit claim was created.':`Performance remains unavailable or unknown; no credit was inferred.${result.code?` Reference: ${result.code}.`:''}`}</p>}
  {!reports.length&&<p>No supplier performance reports recorded.</p>}
  {reports.filter(r=>!claims.some(c=>c.read_id===r.id)).map(report=><article key={report.id} className="lk-card" aria-label={`Supplier performance evidence ${report.month}`}><h4>Supplier performance evidence · {report.month}</h4><ServicePerformanceComparison comparison={parse<any>(report.metrics)}/><p>{report.source_name} · {report.source_reference}</p><p>{report.window_note}</p><p><a href={`/api/locket/files/${report.artifact_id}`} download>Download original supplier report</a></p><details><summary>Supplier report identity</summary><p>SHA-256: {report.response_sha256}</p></details></article>)}
  {claims.map(claim=><ServicePerformanceClaim key={`${claim.id}:${claim.version}`} state={state} agreement={a} locket={locket} claim={claim}/>)}
 </section>
}
