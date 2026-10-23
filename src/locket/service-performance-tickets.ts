import { requireRole } from './access'
import type { Handler } from './commands'
import { fail,list,sha256,text } from './model'
import { visibleAgreement } from './records'
import { serviceMonth } from './service-level-evidence'
import { servicePeople } from './service-level-records'
import { performanceTerm } from './service-performance-records'
import { recordPerformance } from './service-performance-report'
import { linenOrigin,readLinenTicketEvidence } from './service-ticket-evidence'

export const performanceTickets:Handler=async(c,p)=>{
 requireRole(c.actor,servicePeople,'authorize an exact read-only Linen ticket selection')
 const a=await visibleAgreement(c,p.agreementId),current=await performanceTerm(c,a,p.termId)
 if(c.actor.id!==a.owner_id)fail('FORBIDDEN','Only the assigned agreement owner authorizes this exact Linen installation, queue and record scope.',403)
 if(p.consent!==true)fail('CONSENT','Explicitly authorize this installation, queue selection, record IDs and retention of the exact ticket evidence.')
 if(current.term.metric==='delivery')fail('REPORT_UNAVAILABLE','Linen does not publish fulfillment or delivery evidence. Ticket closure is not delivery.',409)
 const period=serviceMonth(p.month,current.config.timeZone,current.config.claimDays)
 if(period.to>c.now)fail('PERIOD_OPEN','Read only a completed authorized service month.',409)
 if(c.now>=period.deadlineAt)fail('CLAIM_CLOSED','The confirmed claim deadline has passed.',409)
 const windowNote=text(p,'windowNote',4000)
 const origin=linenOrigin(c.env.LINEN_ORIGIN),credential=c.env.LINEN_MCP_TOKEN
 if(!credential)fail('LINEN_CONFIG','Configure the server-only owner-minted read-only Linen MCP credential for the exact installation.',409)
 const queueIds=list(p,'queueIds',20),recordIds=list(p,'recordIds',20)
 if(queueIds.some(id=>typeof id!=='string')||recordIds.some(id=>typeof id!=='string'))fail('LINEN_SCOPE','Select explicit string queue and record IDs.')
 const evidence=await readLinenTicketEvidence({installation:origin,credential,queueIds:queueIds as string[],recordIds:recordIds as string[]})
 // Native calendar-hour observations can inform a counsel-confirmed wall clock.
 // Business policies lack the contractual calendar; closure cannot establish resolution.
 const records=evidence.records.map(r=>({...r,firstPublicResponseAt:r.clockBasis==='calendar'?r.firstPublicResponseAt:null,resolvedAt:null}))
 const warnings=[...evidence.warnings,'Linen closure-derived resolution is retained as source provenance but never inferred as contractual resolution. Business or unknown clocks are not compared as wall-clock performance.']
 return recordPerformance(c,p,{file:{filename:`linen-${c.commandId}.json`,mediaType:'application/json',bytes:evidence.bytes},records,kind:'linen',sourceName:'Linen MCP work.get exact selected records',sourceReference:evidence.sourcePath+' records '+(recordIds as string[]).join(', '),windowNote,warnings,connection:{origin,credentialDigest:await sha256(credential),queueIds,recordIds},checks:current.checks})
}
