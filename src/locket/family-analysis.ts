import { requireRole } from './access'
import type { Ctx, Handler } from './commands'
import { addDays } from './dates'
import { installationSettings } from './installation'
import { lifecycle } from './lifecycle'
import { analyzeFamily, type AnalysisConflict } from './family-analysis-model'
import { familyFacts, type FamilyFacts, type FamilySource } from './family-analysis-facts'
import { fail, integer, json, list, object, sql, text, type Sql } from './model'
import { renewalWrites, termKeys } from './obligations'
import { bump } from './records'

async function analysisOf(c:Ctx,id:unknown) {
 const analysis=await c.db.prepare('SELECT * FROM lk_family_analyses WHERE id=?').bind(id).first<any>()
 if(!analysis)fail('NOT_FOUND','No family analysis has that identity.',404)
 const current=await familyFacts(c,analysis.root_id,true)
 if(current.digest!==analysis.source_digest)fail('STALE','The source family changed. Prepare and review a new analysis.',409)
 const latest=await c.db.prepare('SELECT MAX(revision) AS revision FROM lk_family_analyses WHERE root_id=?').bind(analysis.root_id).first<any>()
 if(latest?.revision!==analysis.revision)fail('STALE','Review the latest family analysis.',409)
 return {analysis,current}
}
const prepare:Handler=async(c,p)=>{
 requireRole(c.actor,['owner','counsel'],'prepare a family analysis')
 const current=await familyFacts(c,p.agreementId,true)
 const last=await c.db.prepare('SELECT COALESCE(MAX(revision),0) AS n FROM lk_family_analyses WHERE root_id=?').bind(current.root.id).first<any>()
 const id=crypto.randomUUID(),revision=last.n+1
 return {allowed:['owner','counsel'],result:{id,sourceDigest:current.digest,status:'prepared'},checks:[...current.checks,sql('(SELECT COALESCE(MAX(revision),0) FROM lk_family_analyses WHERE root_id=?)=?',current.root.id,last.n)],writes:[sql("INSERT INTO lk_family_analyses(id,root_id,revision,facts,sources,source_digest,status,prepared_by,prepared_at) VALUES(?,?,?,?,?,?,'prepared',?,?)",id,current.root.id,revision,json(current.facts),json(current.sources),current.digest,c.actor.id,c.now)],audit:[{action:'family.analysis.prepare',agreementId:current.root.id,summary:'Prepared an exact executed-family snapshot; derived actions are blocked until counsel resolves it. No provider request made.'}]}
}
const run:Handler=async(c,p)=>{
 requireRole(c.actor,['owner'],'authorize a family model analysis')
 const {analysis,current}=await analysisOf(c,p.analysisId)
 if(analysis.status!=='prepared')fail('STATUS','This analysis already ran. Prepare a new exact snapshot for another request.',409)
 if(p.consent!==true||p.sourceDigest!==analysis.source_digest)fail('CONSENT','Explicitly approve sending this exact family snapshot to the configured model.',409)
 const conflicts=await analyzeFamily(c,JSON.parse(analysis.sources) as FamilySource[])
 return {allowed:['owner'],result:{id:analysis.id,status:'pending'},checks:[...current.checks,sql("(SELECT status FROM lk_family_analyses WHERE id=?)='prepared'",analysis.id)],writes:[sql("UPDATE lk_family_analyses SET status='pending',conflicts=?,analyzed_at=? WHERE id=?",json(conflicts),c.now,analysis.id)],audit:[{action:'family.analysis.run',agreementId:current.root.id,summary:'Explicit consent to the configured model for the exact executed-family snapshot; verified candidate passages retained. No governing choice applied.'}]}
}
const resolve:Handler=async(c,p)=>{
 requireRole(c.actor,['counsel'],'confirm family precedence and operational scope')
 const {analysis,current}=await analysisOf(c,p.analysisId)
 if(analysis.status!=='pending')fail('STATUS','Analyze the current family before confirming its governing terms.',409)
 const reason=text(p,'reason',4000),conflicts=JSON.parse(analysis.conflicts) as AnalysisConflict[]
 const input=list(p,'choices',30).map(v=>object(v,'choice'))
 if(input.length!==conflicts.length||new Set(input.map(v=>v.key)).size!==input.length)fail('CHOICES','Choose exactly one candidate for each conflict.')
 const choices=conflicts.map(conflict=>{
  const selected=input.find(v=>v.key===conflict.key)
  if(!selected)fail('CHOICES','Choose a candidate for every conflict.')
  return {key:conflict.key,candidate:conflict.candidates[integer(selected,'candidate',0,conflict.candidates.length-1)]}
 })
 if(p.scopeAgreementId!==current.root.id)fail('SCOPE','Confirm the parent agreement as the operational scope. Other agreements are not silently changed.')
 const writes:Sql[]=[],nextFacts:FamilyFacts=structuredClone(current.facts),pendingTerms:any[]=[]
 const confirmed=new Map(current.facts.terms.filter(t=>t.agreementId===current.root.id).map(t=>[t.key,t.value]))
 for(const choice of choices){
  if(!termKeys.includes(choice.key as any))continue // Nonstandard legal/price choices remain explicit governing interpretations.
  const old=nextFacts.terms.filter(t=>t.agreementId===current.root.id&&t.key===choice.key)
  writes.push(sql("UPDATE lk_terms SET status='superseded' WHERE agreement_id=? AND key=? AND status='confirmed'",current.root.id,choice.key))
  const id=crypto.randomUUID(),candidate=choice.candidate
  const citation={source:'family-governing',analysisId:analysis.id,sourceAgreementId:candidate.agreementId,versionId:candidate.versionId,quote:candidate.quote,page:candidate.page}
  writes.push(sql("INSERT INTO lk_terms VALUES(?,?,?,?,?,'confirmed',?,?,?,?,?,?,?)",id,current.root.id,choice.key,candidate.value,json(citation),c.actor.id,analysis.id,c.actor.id,c.now,old[0]?.id??null,reason,c.now))
  pendingTerms.push({id,agreement_id:current.root.id,key:choice.key,value:candidate.value,citation:json(citation),status:'confirmed'})
  nextFacts.terms=nextFacts.terms.filter(t=>!(t.agreementId===current.root.id&&t.key===choice.key))
  nextFacts.terms.push({id,agreementId:current.root.id,key:choice.key,value:candidate.value})
  confirmed.set(choice.key,candidate.value)
 }
 nextFacts.terms.sort((a,b)=>a.id.localeCompare(b.id))
 const settings=await installationSettings(c.db)
 const projected=lifecycle(current.root,nextFacts.terms.map(t=>({...t,agreement_id:t.agreementId,status:'confirmed'})),[],[],c.now,settings.rollNoticeDeadlines)
 const stored=(await c.db.prepare("SELECT * FROM lk_terms WHERE agreement_id=? AND status='confirmed'").bind(current.root.id).all<any>()).results
 const renewal=await renewalWrites(c,current.root,confirmed,[...stored.filter(t=>!pendingTerms.some(p=>p.key===t.key)),...pendingTerms])
 writes.push(...renewal.writes)
 const updates=list(p,'obligations',100).map(v=>object(v,'obligation'))
 if(new Set(updates.map(v=>v.obligationId)).size!==updates.length)fail('INVALID','Each derived obligation is selected once.')
 const dependencies=[]
 const previous=(await c.db.prepare("SELECT s.obligation_id FROM lk_family_obligation_sources s JOIN lk_obligations o ON o.id=s.obligation_id WHERE s.root_id=? AND o.status IN ('proposed','confirmed')").bind(current.root.id).all<any>()).results
 if(previous.some(row=>!updates.some(update=>update.obligationId===row.obligation_id)))fail('OBLIGATION','Review every previously derived open obligation in this resolution.',409)
 for(const update of updates){
  const obligation=await c.db.prepare("SELECT * FROM lk_obligations WHERE id=? AND agreement_id=? AND status IN ('proposed','confirmed')").bind(text(update,'obligationId',100),current.root.id).first<any>()
  if(!obligation)fail('OBLIGATION','Select an open obligation on the scoped parent agreement.',409)
  const key=text(update,'key',50),choice=choices.find(c=>c.key===key),offset=integer(update,'offsetDays',-730,730)
  if(!choice||!['notice_days','end_date','effective_date'].includes(key))fail('OBLIGATION','Derive dates only from a chosen notice period, end date or effective date.')
  const base=key==='notice_days'?projected.deadline?.date:key==='end_date'?projected.end:confirmed.get('effective_date')
  if(!base)fail('OBLIGATION','This selected term has no confirmed operational date.',409)
  const due=addDays(base,offset)
  writes.push(sql('UPDATE lk_obligations SET due_date=? WHERE id=?',due,obligation.id),sql('INSERT INTO lk_family_obligation_sources VALUES(?,?,?,?,?,?,?) ON CONFLICT(obligation_id) DO UPDATE SET analysis_id=excluded.analysis_id,term_key=excluded.term_key,offset_days=excluded.offset_days,selected_by=excluded.selected_by,selected_at=excluded.selected_at',obligation.id,current.root.id,analysis.id,key,offset,c.actor.id,c.now))
  dependencies.push({obligationId:obligation.id,key,offsetDays:offset,dueDate:due})
 }
 // Future validation compares the post-propagation confirmed terms. Original
 // approved source snapshot and model passages remain immutable in sources.
 writes.push(sql("UPDATE lk_family_analyses SET status='resolved',facts=?,choices=?,resolved_by=?,resolved_at=?,reason=? WHERE id=?",json(nextFacts),json({terms:choices,obligations:dependencies,scopeAgreementId:current.root.id}),c.actor.id,c.now,reason,analysis.id),bump(c,current.root))
 return {allowed:['counsel'],result:{id:analysis.id,status:'resolved'},checks:[...current.checks,...renewal.checks,sql("(SELECT status FROM lk_family_analyses WHERE id=?)='pending'",analysis.id)],writes,audit:[{action:'family.analysis.resolve',agreementId:current.root.id,summary:`Counsel confirmed exact governing interpretations and root operational scope with reason; propagated ${choices.length} terms and ${dependencies.length} selected obligation dates. ${renewal.summary??''}`}]}
}
export const familyAnalysisHandlers:Record<string,Handler>={'family.analysis.prepare':prepare,'family.analysis.run':run,'family.analysis.resolve':resolve}
