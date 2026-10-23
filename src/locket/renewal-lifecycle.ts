import type { Bindings } from '../auth.server'
import type { Ctx, Handler } from './commands'
import { guardSql } from './commands'
import { may, requireRole } from './access'
import { familyClear, requireFamilyClear } from './family-analysis-guard'
import { installationSettings } from './installation'
import { lifecycle } from './lifecycle'
import { canonical, date, fail, integer, json, oneOf, sha256, sql, text, type Actor, type Sql } from './model'
import { agreementGuards, bump, visibleAgreement, type AgreementRow } from './records'
import { citation } from './obligations'
import { notificationBatch, notificationCheck, notificationWrites } from './notifications'

type Row = { id: string; [key: string]: any }
const rows = async (db: D1Database, query: string, ...args: unknown[]) => (await db.prepare(query).bind(...args).all<Row>()).results
const renewalKeys = ['effective_date','end_date','initial_term_months','auto_renew','renewal_type','renewal_term_months','renewals_allowed','notice_days']
/** Returns writes for the caller's existing guarded transaction. Pending confirmed
 * rows may be supplied by term confirmation; no partial term update is committed. */
export async function reconcileRenewalWrites(c: Ctx, a: AgreementRow, supplied?: Row[], renewalOverride:Record<string,unknown>={}) {
  const terms = supplied ?? await rows(c.db, "SELECT * FROM lk_terms WHERE agreement_id=? AND status='confirmed'", a.id)
  const sources = terms.filter(t => t.status === 'confirmed' && renewalKeys.includes(t.key)).sort((x,y) => x.key.localeCompare(y.key))
  const settings = await installationSettings(c.db)
  const sourceDigest = await sha256(canonical({ timezone:a.timezone, roll:settings.rollNoticeDeadlines, sources:sources.map(t => ({id:t.id,key:t.key,value:t.value})) }))
  const old = await c.db.prepare('SELECT * FROM lk_renewals WHERE agreement_id=?').bind(a.id).first<Row>()
  const previous = await c.db.prepare('SELECT * FROM lk_renewal_generations WHERE agreement_id=? AND superseded_at IS NULL').bind(a.id).first<Row>()
  const changed = previous?.source_digest !== sourceDigest
  const generation = changed ? crypto.randomUUID() : previous!.id
  const setting = await c.db.prepare('SELECT * FROM lk_renewal_settings WHERE agreement_id=?').bind(a.id).first<Row>()
  const r: Row = { ...old, id:old?.id ?? crypto.randomUUID(), agreement_id:a.id, generation_id:generation, evergreen_lead_days:setting?.evergreen_lead_days ?? 30,...renewalOverride }
  if (changed && previous) Object.assign(r,{decision:null,decided_by:null,decided_at:null,decisions:'{}',term_number:1})
  const notices = await rows(c.db,'SELECT * FROM lk_notices WHERE agreement_id=?',a.id)
  // Legacy notices belong to the first source generation, never a corrected one.
  if (!previous) for (const n of notices) if (!n.generation_id) n.generation_id = generation
  const current = lifecycle(a,terms,[r],notices,c.now,settings.rollNoticeDeadlines)
  if (!current.chain.length && current.renewalType !== 'evergreen') return { writes:[] as Sql[], checks:[] as Sql[], current }
  const writes: Sql[] = []
  const checks = [sql('(SELECT version FROM lk_agreements WHERE id=?)=?',a.id,a.version),...(supplied ? [] : [familyClear(a.id)]),
    previous ? sql('(SELECT id FROM lk_renewal_generations WHERE agreement_id=? AND superseded_at IS NULL)=?',a.id,previous.id) : sql('NOT EXISTS(SELECT 1 FROM lk_renewal_generations WHERE agreement_id=? AND superseded_at IS NULL)',a.id)]
  if (changed) {
    writes.push(sql('UPDATE lk_renewal_generations SET superseded_at=? WHERE agreement_id=? AND superseded_at IS NULL',c.now,a.id))
    writes.push(sql('INSERT INTO lk_renewal_generations VALUES(?,?,?,?,?,NULL)',generation,a.id,sourceDigest,json(sources.map(t=>({id:t.id,key:t.key,value:t.value,citation:t.citation}))),c.now))
    if (!previous) writes.push(sql('UPDATE lk_notices SET generation_id=? WHERE agreement_id=? AND generation_id IS NULL',generation,a.id))
  }
  for (const term of current.chain.filter(t=>t.committed)) writes.push(sql(`INSERT INTO lk_renewal_history VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(generation_id,term_number) DO NOTHING`,crypto.randomUUID(),a.id,generation,term.term,term.start,term.end,term.deadline?.date??null,term.deadline?.at??null,term.decision,term.decidedBy,term.decidedAt,c.now,term.imported?1:0,1))
  const decisions = r.decisions ? JSON.parse(r.decisions) : {}
  if (r.decision) decisions[String(r.term_number ?? 1)]={...decisions[String(r.term_number ?? 1)],decision:r.decision,decidedBy:r.decided_by,decidedAt:r.decided_at}
  const d = decisions[String(current.term)]
  const dateEnd = current.end ?? current.start ?? ''
  writes.push(sql(`INSERT INTO lk_renewals(id,agreement_id,end_date,notice_days,deadline_date,deadline_at,timezone,auto_renew,decision,decided_by,decided_at,decision_reason,updated_at,term_number,generation_id,decisions,termination_date,evergreen_lead_days)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(agreement_id) DO UPDATE SET end_date=excluded.end_date,notice_days=excluded.notice_days,deadline_date=excluded.deadline_date,deadline_at=excluded.deadline_at,timezone=excluded.timezone,auto_renew=excluded.auto_renew,decision=excluded.decision,decided_by=excluded.decided_by,decided_at=excluded.decided_at,decision_reason=excluded.decision_reason,updated_at=excluded.updated_at,term_number=excluded.term_number,generation_id=excluded.generation_id,decisions=excluded.decisions,termination_date=excluded.termination_date,evergreen_lead_days=excluded.evergreen_lead_days`,
    r.id,a.id,dateEnd,Number(terms.find(t=>t.key==='notice_days'&&t.status==='confirmed')?.value??0),current.deadline?.date??'',current.deadline?.at??0,a.timezone,current.renewalType==='auto_renew'?1:0,d?.decision??null,d?.decidedBy??null,d?.decidedAt??null,current.term===(r.term_number??1)?r.decision_reason??null:null,c.now,current.term,generation,json(decisions),r.termination_date??null,r.evergreen_lead_days))
  if (current.terminationUnsent) {
    const recipients = await rows(c.db,"SELECT o.id FROM oa_operators o LEFT JOIN lk_roles r ON r.operator_id=o.id WHERE o.status='active' AND (o.role='owner' OR r.role='counsel')")
    for (const recipient of recipients) writes.push(...notificationWrites(c,{key:`termination-missing:${generation}:${current.term}`,agreementId:a.id,recipientId:recipient.id,kind:'deadline_termination_missing'}))
  }
  if (current.review && current.review.dueAt <= c.now) writes.push(...notificationWrites(c,{key:`evergreen-review:${a.id}:${current.review.date}`,agreementId:a.id,recipientId:a.owner_id,kind:'deadline_evergreen_review'}))
  return { writes, checks, current }
}
const configure: Handler = async(c,p) => {
  requireRole(c.actor,may.manageRoles,'configure evergreen reviews')
  const a=await visibleAgreement(c,p.agreementId),lead=integer(p,'leadDays',0,365)
  return {allowed:may.manageRoles,result:{agreementId:a.id,leadDays:lead},checks:agreementGuards(c,a,p),writes:[sql('INSERT INTO lk_renewal_settings VALUES(?,?,?,?) ON CONFLICT(agreement_id) DO UPDATE SET evergreen_lead_days=excluded.evergreen_lead_days,configured_by=excluded.configured_by,configured_at=excluded.configured_at',a.id,lead,c.actor.id,c.now),sql('UPDATE lk_renewals SET evergreen_lead_days=? WHERE agreement_id=?',lead,a.id),bump(c,a)],audit:[{action:'renewal.review.configure',agreementId:a.id,summary:`Evergreen review ${lead} days before each anniversary.`}]}
}
const terminate: Handler = async(c,p) => {
  requireRole(c.actor,may.confirmTerms,'record a cited early termination')
  const a=await visibleAgreement(c,p.agreementId),family=await requireFamilyClear(c,a.id)
  const r=await c.db.prepare('SELECT * FROM lk_renewals WHERE agreement_id=?').bind(a.id).first<Row>()
  if(!r)fail('NO_TERMS','Confirm renewal terms first.',409)
  const effective=date(p,'effectiveDate'),cite=await citation(c,a,p.citation),reason=text(p,'reason',2000)
  const terms=await rows(c.db,"SELECT * FROM lk_terms WHERE agreement_id=? AND status='confirmed'",a.id)
  const start=terms.find(t=>t.key==='effective_date')?.value
  if(start&&effective<start)fail('INVALID','Termination cannot precede the agreement’s effective date.')
  const notices=await rows(c.db,'SELECT * FROM lk_notices WHERE agreement_id=?',a.id)
  const current=lifecycle(a,terms,[r],notices,c.now,(await installationSettings(c.db)).rollNoticeDeadlines)
  if(current.end&&effective>addDay(current.end))fail('INVALID','An earlier termination cannot extend the current term.')
  const reconciled=await reconcileRenewalWrites(c,a,terms,{termination_date:effective})
  return {allowed:may.confirmTerms,result:{agreementId:a.id,effectiveDate:effective},checks:[family,...agreementGuards(c,a,p),...reconciled.checks],writes:[sql('INSERT INTO lk_renewal_terminations VALUES(?,?,?,?,?,?,?,?,?,?,?)',crypto.randomUUID(),a.id,r.generation_id,r.term_number,'early_termination',effective,json(cite),null,c.actor.id,c.now,reason),...reconciled.writes,bump(c,a)],audit:[{action:'renewal.terminate',agreementId:a.id,summary:`Recorded cited termination effective ${effective}.`}]}
}
const resolve: Handler = async(c,p) => {
  requireRole(c.actor,['owner','counsel'],'resolve a termination without timely notice')
  const a=await visibleAgreement(c,p.agreementId),family=await requireFamilyClear(c,a.id)
  const r=await c.db.prepare('SELECT * FROM lk_renewals WHERE agreement_id=?').bind(a.id).first<Row>()
  if(!r||r.decision!=='terminate')fail('STATUS','There is no termination decision to resolve.',409)
  const resolution=oneOf(p,'resolution',['renewed','notice_recorded'] as const),reason=text(p,'reason',2000)
  const decisions=JSON.parse(r.decisions??'{}'),writes:Sql[]=[]
  let notice:Row|null=null
  if(resolution==='notice_recorded') {
    notice=await c.db.prepare("SELECT * FROM lk_notices WHERE id=? AND renewal_id=? AND status='sent' AND generation_id=? AND term_number=? AND evidence_artifact_id IS NOT NULL").bind(text(p,'noticeId',100),r.id,r.generation_id,r.term_number).first<Row>()
    if(!notice)fail('EVIDENCE','Record this term’s notice as sent with evidence first.',409)
    // Counsel explicitly reconciles late evidence; the operative end remains the current term’s end.
    writes.push(sql('UPDATE lk_renewals SET termination_date=? WHERE id=?',addDay(r.end_date),r.id))
  } else {
    decisions[String(r.term_number)]={confirmedRenewed:true,decision:'renew',decidedBy:c.actor.id,decidedAt:c.now}
    writes.push(sql("UPDATE lk_renewals SET decision='renew',decided_by=?,decided_at=?,decisions=?,termination_date=NULL WHERE id=?",c.actor.id,c.now,json(decisions),r.id))
  }
  writes.push(sql('INSERT INTO lk_renewal_terminations VALUES(?,?,?,?,?,?,?,?,?,?,?)',crypto.randomUUID(),a.id,r.generation_id,r.term_number,resolution,null,null,notice?.id??null,c.actor.id,c.now,reason),bump(c,a))
  return {allowed:['owner','counsel'],result:{agreementId:a.id,resolution},checks:[family,...agreementGuards(c,a,p)],writes,audit:[{action:'renewal.termination.resolve',agreementId:a.id,summary:`Resolved termination: ${resolution}; ${reason}`}]}
}
function addDay(date:string) { const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10) }
export const renewalLifecycleHandlers:Record<string,Handler>={'renewal.review.configure':configure,'renewal.terminate':terminate,'renewal.termination.resolve':resolve}
export async function renewalLifecycleState(db:D1Database,ids:Set<string>) {
  const scoped=async(table:string)=>(await rows(db,`SELECT * FROM ${table}`)).filter(r=>ids.has(r.agreement_id))
  return {renewalHistory:await scoped('lk_renewal_history'),renewalGenerations:await scoped('lk_renewal_generations'),renewalSettings:await scoped('lk_renewal_settings'),renewalTerminations:await scoped('lk_renewal_terminations')}
}
/** Hourly invocation is safe; every agreement is checked at least daily. No mail
 * or provider operation is claimed until source/family/version fences pass. */
export async function runRenewalLifecycle(env:Bindings,now:number) {
  const owner=await env.DB.prepare("SELECT id,display_name AS name,email,version FROM oa_operators WHERE role='owner' AND status='active' LIMIT 1").first<any>()
  if(!owner)return
  const actor:Actor={...owner,role:'owner',sessionId:'',operatorVersion:owner.version}
  for(const row of await rows(env.DB,"SELECT * FROM lk_agreements WHERE status IN ('executed','imported')")) {
    const a=row as AgreementRow,c:Ctx={env,db:env.DB,actor,now,commandId:crypto.randomUUID()}
    if(!await notificationCheck(env.DB,[familyClear(a.id)]))continue
    const out=await reconcileRenewalWrites(c,a)
    if(!out.writes.length)continue
    const guard=crypto.randomUUID()
    try { await notificationBatch(env.DB,[guardSql(guard,[sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND role='owner' AND status='active')",owner.id,owner.version),...out.checks]),...out.writes,sql('DELETE FROM lk_guard WHERE id=?',guard)]) }
    catch(error){if(!/UNIQUE constraint|LOCKET_GUARD|CHECK constraint/.test(String(error)))throw error}
  }
}
