import { useState } from 'react'
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { can, parse, personName } from './format'
import { ServiceLevelSettings } from './service-levels-settings'
import { ServiceLevelClaim, ServiceLevelMetrics } from './service-levels-claim'

export interface ServiceLevelWorkspace {
 serviceLevels:{links:Row[];terms:Row[];reads:Row[];claims:Row[];breaches:Row[];dispatches:Row[]}
}
export type ServiceLevelState=LocketState&ServiceLevelWorkspace
export type ServiceLevelProps={state:ServiceLevelState;a:Row;locket:Locket}
export const serviceUsd=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100)+' USD'
export const serviceSourceStale=(state:LocketState,sources:string)=>parse<any[]>(sources).some(source=>state.agreements.find(a=>a.id===source.id)?.version!==source.version)

export function ServiceLevels({state,a,locket}:ServiceLevelProps) {
 const [readResult,setReadResult]=useState<{status:string;code?:string}|null>(null)
 if(a.type!=='supplier'||!['executed','imported'].includes(a.status))return null
 const data=state.serviceLevels,link=data.links.find(l=>l.agreement_id===a.id),term=data.terms.find(t=>t.agreement_id===a.id)
 const reads=data.reads.filter(r=>r.agreement_id===a.id),claims=data.claims.filter(c=>c.agreement_id===a.id)
 const current=Boolean(link&&term&&term.link_version===link.version&&!serviceSourceStale(state,term.sources))
 return <section className="lk-card lk-service-levels" aria-label="Supplier service levels" style={{minWidth:0,overflowWrap:'anywhere'}}>
  <style>{`.lk-service-levels button{white-space:normal;max-width:100%;line-height:1.3}.lk-service-levels .lk-form,.lk-service-levels .lk-form-actions{min-width:0}.lk-service-levels blockquote{margin-inline:0;padding-inline:12px}`}</style>
  <h3>Supplier service levels</h3>
  <p>Compare a complete month of observed Uptime monitoring with a counsel-confirmed signed commitment and credit tier. The agreement owner approves the amount and exact message, then separately chooses whether to send it.</p>
  <ServiceLevelSettings state={state} a={a} locket={locket}/>
  {link&&<p>Authorized Uptime origin: {link.origin} · Monitor: {link.monitor_id}</p>}
  {link?.last_error&&<p role="status">Monitoring evidence unavailable: {link.last_error} No claim amount was inferred from unavailable or out-of-tier evidence.</p>}
  {term&&<blockquote><p>{parse<any>(term.citation).quote}</p><p>Commitment {term.target_bps/100}% · Tier {term.tier_floor_bps/100}% up to {term.target_bps/100}% · Credit {term.credit_bps/100}% of {serviceUsd(term.monthly_cents)} monthly.</p><p>{term.interpretation}</p><p>Confirmed by {personName(state,term.confirmed_by)} · {term.timezone} · claim within {term.claim_days} days after month end.</p><a href={`#agreement/${term.source_agreement_id}/terms`}>Signed service-level clause source</a></blockquote>}
  {!current&&<p role="status">The installation owner must authorize the monitor, and counsel must confirm the current signed sources before monitoring evidence can be read.</p>}
  {current&&can(state,'owner','counsel','approver','requester','agent')&&<Form busy={locket.busy} submit="Read monthly monitoring evidence" onSubmit={async data=>{const result=await locket.run('service-level.read',{agreementId:a.id,month:value(data,'month')});if(result)setReadResult({status:result.status,code:result.code})}}>
   <Field label="Service month" hint={`Choose a completed calendar month in ${term!.timezone}.`}><input name="month" type="month" required/></Field>
   <p>The original response is retained unchanged. Unknown, paused and maintenance durations are shown separately; missing evidence never becomes a measured breach or credit.</p>
  </Form>}
  {readResult&&<p role="status">{readResult.status==='breached'?'Service-level breach recorded; a proposed credit claim is ready for owner review.':readResult.status==='met'?'The observed monthly availability meets the confirmed commitment. No credit claim was created.':`Monitoring availability is unavailable. No claim was inferred.${readResult.code?` Reference: ${readResult.code}.`:''}`}</p>}
  {!reads.length&&<p>No monthly monitoring evidence recorded.</p>}
  {reads.filter(r=>!claims.some(c=>c.read_id===r.id)).map(read=><article key={read.id} className="lk-card" aria-label={`Monitoring evidence ${read.month}`}><h4>Monitoring evidence · {read.month}</h4><ServiceLevelMetrics read={read}/></article>)}
  {claims.map(claim=><ServiceLevelClaim key={`${claim.id}:${claim.version}`} state={state} a={a} locket={locket} claim={claim}/>)}
 </section>
}
