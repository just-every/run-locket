// A provider-authenticated reply stops the whole approved schedule, without
// treating a sender address as identity verification or accepting evidence.
import type { Bindings } from '../auth.server'
import { requireRole, may } from './access'
import type { Handler } from './commands'
import { auditSql } from './commands'
import { fail, oneOf, Problem, sha256, sql, text } from './model'
import { visibleAgreement, agreementGuards } from './records'
import { replyDomain } from './exchange-inbound'

export function remediationSchedule(rows:{send_at:number}[]) {
 const times=rows.map(r=>r.send_at).sort((a,b)=>a-b)
 return {maximumOccurrences:times.length,minimumSpacingMs:times.length>1?Math.min(...times.slice(1).map((at,i)=>at-times[i])):null}
}
export function remediationReplyAddress(env:Bindings,requestId:string) {
 const domain=replyDomain(env)
 return domain&&env.POSTMARK_INBOUND_SECRET?`remediation+${requestId}@${domain}`:null
}
export function remediationStopWrites(id:string,now:number,kind:string,reference:string) {
 return [sql("UPDATE lk_remediation_requests SET status='cancelled',stopped_at=?,stop_kind=?,stop_reference=? WHERE id=? AND stopped_at IS NULL",now,kind,reference,id),sql("UPDATE lk_remediation_occurrences SET status='cancelled',outcome_code=? WHERE request_id=? AND status='pending'",kind,id)]
}
const recordStop:Handler=async(c,p)=>{
 requireRole(c.actor,may.review,'record a remediation reply or opt-out')
 const r=await c.db.prepare('SELECT * FROM lk_remediation_requests WHERE id=?').bind(p.requestId).first<any>()
 if(!r)fail('NOT_FOUND','No remediation request.',404)
 const a=await visibleAgreement(c,r.agreement_id)
 const o=await c.db.prepare('SELECT owner_id FROM lk_obligations WHERE id=(SELECT obligation_id FROM lk_remediation_requirements WHERE id=?)').bind(r.requirement_id).first<{owner_id:string}>()
 if(o?.owner_id!==c.actor.id)fail('FORBIDDEN','Only the obligation owner records a recipient reply or opt-out.',403)
 const kind=oneOf(p,'kind',['recipient_reply','recipient_opt_out'] as const),reference=text(p,'reference',1000)
 return {allowed:may.review,result:{id:r.id,status:'cancelled'},checks:[...agreementGuards(c,a),sql('EXISTS(SELECT 1 FROM lk_obligations o JOIN lk_remediation_requirements q ON q.obligation_id=o.id WHERE q.id=? AND o.owner_id=?)',r.requirement_id,c.actor.id)],writes:remediationStopWrites(r.id,c.now,kind,reference),audit:[{action:'remediation.stop',agreementId:a.id,summary:`Obligation owner recorded ${kind}; every future occurrence stopped. Obligation and evidence requirements remain unchanged.`}]}
}
export const remediationStopHandlers={'remediation.stop':recordStop}

export async function inboundRemediationResponse(request:Request,env:Bindings):Promise<Response|null> {
 if(new URL(request.url).pathname!=='/api/locket/remediation/inbound')return null
 const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}})
 try {
  if(request.method!=='POST')fail('METHOD','Use POST.',405)
  if(!env.POSTMARK_INBOUND_SECRET||!replyDomain(env))fail('INBOUND_UNAVAILABLE','Configure authenticated inbound email.',503)
  const auth=request.headers.get('authorization')??''
  let supplied=auth.startsWith('Bearer ')?auth.slice(7):''
  if(auth.startsWith('Basic ')){try{const decoded=atob(auth.slice(6));if(decoded.startsWith('locket:'))supplied=decoded.slice(7)}catch{}}
  const expected=await sha256(env.POSTMARK_INBOUND_SECRET),actual=await sha256(supplied)
  let difference=0;for(let i=0;i<expected.length;i++)difference|=expected.charCodeAt(i)^actual.charCodeAt(i)
  if(difference)fail('AUTH','Inbound provider authentication failed.',401)
  if(!(request.headers.get('content-type')??'').includes('application/json'))fail('INVALID','Send JSON.',415)
  const raw=await request.text()
  if(raw.length>65536)fail('FILE_SIZE','Reply envelope exceeds 64 KiB; send metadata only.',413)
  const p=JSON.parse(raw),recipient=text(p,'OriginalRecipient',400).toLowerCase(),match=recipient.match(/^remediation\+([a-f0-9-]{36})@(.+)$/)
  if(!match||match[2]!==replyDomain(env))fail('RECIPIENT','Choose this installation’s remediation reply address.',403)
  const r=await env.DB.prepare('SELECT * FROM lk_remediation_requests WHERE id=?').bind(match[1]).first<any>()
  if(!r)fail('NOT_FOUND','No remediation request.',404)
  const from=text(p,'From',320).toLowerCase()
  if(from!==r.recipient.toLowerCase()||(p.FromFull&&text(p.FromFull,'Email',320).toLowerCase()!==from))fail('SENDER','Only the recorded request recipient may stop its schedule.',403)
  const now=Date.now(),messageId=text(p,'MessageID',200),kind=p.OptOut===true?'recipient_opt_out':'recipient_reply'
  const audit=auditSql({env,db:env.DB,now,commandId:crypto.randomUUID(),actor:{id:r.approved_by??r.prepared_by,name:'Authenticated inbound provider',email:'',operatorVersion:0,role:'viewer',sessionId:''}},{action:'remediation.stop',agreementId:r.agreement_id,summary:`Provider-authenticated ${kind} attributed to the designated recipient; sender identity unverified. Every future occurrence stopped; no evidence accepted.`},'provider')
  await env.DB.batch([sql(`INSERT INTO lk_audit SELECT ${audit.params.map(()=>'?').join(',')} WHERE EXISTS(SELECT 1 FROM lk_remediation_requests WHERE id=? AND stopped_at IS NULL)`,...audit.params,r.id),...remediationStopWrites(r.id,now,kind,messageId)].map(s=>env.DB.prepare(s.sql).bind(...s.params)))
  return reply({ok:true,status:'cancelled'})
 }catch(error){if(error instanceof Problem)return reply({ok:false,error:{code:error.code,message:error.message}},error.status);if(error instanceof SyntaxError)return reply({ok:false,error:{code:'INVALID',message:'Send a JSON envelope.'}},400);return reply({ok:false,error:{code:'SERVER',message:'Could not record the reply.'}},500)}
}
