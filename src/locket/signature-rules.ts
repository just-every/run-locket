import { may, requireRole, roleSql, visibleSql } from './access'
import { approvalSample, matchingRules, type ApprovalRule } from './approval-rules'
import type { Ctx, Handler } from './commands'
import { fail, integer, json, list, money, object, oneOf, optionalText, sql, text, type Actor, type Sql } from './model'
import type { AgreementRow } from './records'

export const signatureTypes = ['customer','supplier','nda','amendment','order_form','other'] as const
export interface SignerRule { id:string; name:string; signerId:string; order:number; when:{type:string|null;minimumCents:number|null;maximumCents:number|null;departmentId:string|null;entityId:string|null} }
export interface SignerSample {type:string;valueCents:number|null;departmentId:string;entityId:string|null}
export const ruleDraft = (db:D1Database) => db.prepare("SELECT * FROM lk_signature_rule_drafts WHERE id='installation'").first<any>()
export async function frozenSignatureRules(db:D1Database,agreementId:string):Promise<string|null> {
 const snapshot=await db.prepare('SELECT ruleset_id FROM lk_signature_rule_snapshots WHERE agreement_id=?').bind(agreementId).first<{ruleset_id:string|null}>()
 return snapshot?snapshot.ruleset_id:(await ruleDraft(db))?.published_id??null
}
export async function captureSignatureRuleSet(c:Ctx,a:Pick<AgreementRow,'id'>) {
 const draft=await ruleDraft(c.db)
 return {checks:[sql("(SELECT published_id FROM lk_signature_rule_drafts WHERE id='installation') IS ?",draft?.published_id??null)],writes:[sql('INSERT INTO lk_signature_rule_snapshots VALUES(?,?,?)',a.id,draft?.published_id??null,c.now)]}
}
export const signerCheck = (id:string) => sql("EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=? AND o.status='active' AND (o.role='owner' OR COALESCE((SELECT role FROM lk_roles WHERE operator_id=o.id),'viewer') IN ('owner','approver','requester')))",id)
export async function signer(db:D1Database,id:string) {
 const check=signerCheck(id)
 if(!(await db.prepare(`SELECT ${check.sql} AS ok`).bind(...check.params).first<{ok:number}>())?.ok)fail('SIGNER','Choose a current human signer with owner, approver or requester authority.',409)
 return (await db.prepare('SELECT id,display_name AS name,email,version FROM oa_operators WHERE id=?').bind(id).first<{id:string;name:string;email:string;version:number}>())!
}
/** The APPROVE-002 matcher supplies type/USD/department ordering; signer rules add entity and an exclusive upper bound. */
export function matchingSigners(rules:SignerRule[],sample:SignerSample) {
 const candidates=rules.filter(r=>(!r.when.entityId||r.when.entityId===sample.entityId)&&(r.when.maximumCents===null||sample.valueCents!==null&&sample.valueCents<r.when.maximumCents))
 const shared:ApprovalRule[]=candidates.map(r=>({id:r.id,name:r.name,approverId:r.signerId,escalationId:null,order:r.order,when:{type:r.when.type,minimumCents:r.when.minimumCents,departmentId:r.when.departmentId,risk:null,dataProcessing:null,findingKey:null}}))
 return matchingRules(shared,{...sample,risk:'unknown',dataProcessing:false,findingKeys:[]}).map(m=>candidates.find(r=>r.id===m.id)!)
}
export async function selectSigner(db:D1Database,ruleset:any,sample:SignerSample) {
 const matched=matchingSigners(JSON.parse(ruleset.definition),sample)[0]
 const namedId=matched?.signerId??ruleset.fallback_id
 const away=await db.prepare('SELECT away,version FROM lk_approval_absences WHERE operator_id=?').bind(namedId).first<{away:number;version:number}>()
 const chosen=away?.away?ruleset.fallback_id:namedId
 const person=await signer(db,chosen)
 const fallbackAway=await db.prepare('SELECT away,version FROM lk_approval_absences WHERE operator_id=?').bind(chosen).first<{away:number;version:number}>()
 if(fallbackAway?.away)fail('SIGNER_UNAVAILABLE','The required fallback signer is unavailable. The owner must record an available signer before preparing a packet.',409)
 return {person,ruleId:matched?.id??null,rulesetId:ruleset.id??null,fallback:!matched||!!away?.away,checks:[signerCheck(chosen),sql('(SELECT version FROM oa_operators WHERE id=?)=?',chosen,person.version),sql('COALESCE((SELECT version FROM lk_approval_absences WHERE operator_id=?),0)=?',namedId,away?.version??0),sql('COALESCE((SELECT version FROM lk_approval_absences WHERE operator_id=?),0)=?',chosen,fallbackAway?.version??0)]}
}
export async function agreementSigner(db:D1Database,a:AgreementRow,rulesetId:string|null) {
 if(!rulesetId)return null
 const ruleset=await db.prepare('SELECT * FROM lk_signature_rule_versions WHERE id=?').bind(rulesetId).first<any>()
 if(!ruleset)fail('SIGNER_RULES','The captured signer rules are missing.',409)
 const selected=await selectSigner(db,ruleset,{...await approvalSample(db,a),entityId:a.entity_id})
 const access=visibleSql({id:selected.person.id} as Actor,a.id)
 if(!(await db.prepare(`SELECT ${access.sql} AS ok`).bind(...access.params).first<{ok:number}>())?.ok)fail('SIGNER_ACCESS','The selected signer needs current access to this agreement before it can leave in a packet.',409)
 selected.checks.push(access)
 return selected
}
/** Repeat group membership and requester relationship inside the consequential batch. */
export function coordinatorCheck(c:Ctx,a:AgreementRow):Sql {
 return sql(`((${roleSql})='owner' OR (((${roleSql})='approver' OR ((${roleSql})='requester' AND ?=?)) AND (NOT EXISTS(SELECT 1 FROM lk_signature_coordinators WHERE type=? AND audience_id IS NOT NULL) OR EXISTS(SELECT 1 FROM lk_signature_coordinators p JOIN lk_intake_members m ON m.audience_id=p.audience_id WHERE p.type=? AND m.operator_id=?))))`,c.actor.id,c.actor.id,c.actor.id,c.actor.id,a.requester_id,a.type,a.type,c.actor.id)
}
export async function requireCoordinator(c:Ctx,a:AgreementRow) {
 requireRole(c.actor,may.signature,'coordinate signature packets')
 const check=coordinatorCheck(c,a)
 if(!(await c.db.prepare(`SELECT ${check.sql} AS ok`).bind(...check.params).first<{ok:number}>())?.ok)fail('FORBIDDEN','Only the owner, an approver or this agreement’s requester in its configured signature coordinator group may coordinate this packet.',403)
 return check
}
const save:Handler=async(c,p)=>{
 requireRole(c.actor,['owner'],'design signer rules')
 const prior=await ruleDraft(c.db),version=integer(p,'version',0),fallbackId=text(p,'fallbackId',100)
 if(version!==(prior?.version??0))fail('STALE','Signer rules changed. Reload.',409)
 await signer(c.db,fallbackId)
 const checks:Sql[]=[signerCheck(fallbackId),sql("COALESCE((SELECT version FROM lk_signature_rule_drafts WHERE id='installation'),0)=?",version)]
 const rules:SignerRule[]=[]
 for(const value of list(p,'rules',50)) {
  const r=object(value),w=object(r.when??{}),signerId=text(r,'signerId',100)
  await signer(c.db,signerId);checks.push(signerCheck(signerId))
  const departmentId=optionalText(w,'departmentId',100),entityId=optionalText(w,'entityId',100)
  for(const [id,table,condition] of [[departmentId,'lk_intake_audiences'," AND kind='department'"],[entityId,'lk_entities','']] as const)if(id){const check=sql(`EXISTS(SELECT 1 FROM ${table} WHERE id=?${condition})`,id);if(!(await c.db.prepare(`SELECT ${check.sql} AS ok`).bind(...check.params).first<{ok:number}>())?.ok)fail('INVALID','Choose a recorded department and entity.');checks.push(check)}
  const minimumCents=money(w,'minimumValue'),maximumCents=money(w,'maximumValue')
  if(minimumCents!==null&&maximumCents!==null&&maximumCents<=minimumCents)fail('INVALID','The exclusive upper value must exceed the lower value.')
  rules.push({id:r.id?text(r,'id',100):crypto.randomUUID(),name:text(r,'name',160),signerId,order:integer(r,'order',1,50),when:{type:w.type?oneOf(w,'type',signatureTypes):null,minimumCents,maximumCents,departmentId,entityId}})
 }
 if(new Set(rules.map(r=>r.id)).size!==rules.length)fail('INVALID','Each signer rule needs a distinct identity.')
 return {allowed:['owner'],result:{version:version+1},checks,writes:[sql("INSERT INTO lk_signature_rule_drafts VALUES('installation',?,?,1,NULL,NULL) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition,fallback_id=excluded.fallback_id,version=version+1,previewed_version=NULL",json(rules),fallbackId)],audit:[{action:'signature.rules.save',summary:'Saved signer rules and required fallback; publication unchanged.'}]}
}
const preview:Handler=async(c,p)=>{
 requireRole(c.actor,['owner'],'preview signer rules')
 const d=await ruleDraft(c.db),version=integer(p,'version',1)
 if(!d||version!==d.version)fail('STALE','Reload the signer rule draft.',409)
 const input=object(p.sample),sample={type:oneOf(input,'type',signatureTypes),valueCents:money(input,'value'),departmentId:optionalText(input,'departmentId',100)??'',entityId:optionalText(input,'entityId',100)}
 const route=await selectSigner(c.db,d,sample)
 return {allowed:['owner'],result:{signer:route.person,ruleId:route.ruleId,fallback:route.fallback},checks:[...route.checks,sql("(SELECT version FROM lk_signature_rule_drafts WHERE id='installation')=?",version)],writes:[sql("UPDATE lk_signature_rule_drafts SET previewed_version=? WHERE id='installation'",version)],audit:[{action:'signature.rules.preview',summary:'Previewed signer rules against explicit type, USD value, department and entity.'}]}
}
const publish:Handler=async(c,p)=>{
 requireRole(c.actor,['owner'],'publish signer rules')
 const d=await ruleDraft(c.db),version=integer(p,'version',1)
 if(!d||d.version!==version||d.previewed_version!==version)fail('PREVIEW','Preview the current signer rule draft before publishing.',409)
 const id=crypto.randomUUID(),number=(await c.db.prepare('SELECT COALESCE(MAX(number),0)+1 AS n FROM lk_signature_rule_versions').first<{n:number}>())!.n
 return {allowed:['owner'],result:{id,number},checks:[sql("EXISTS(SELECT 1 FROM lk_signature_rule_drafts WHERE id='installation' AND version=? AND previewed_version=?)",version,version),...[d.fallback_id,...JSON.parse(d.definition).map((r:SignerRule)=>r.signerId)].map(signerCheck)],writes:[sql('INSERT INTO lk_signature_rule_versions VALUES(?,?,?,?,?,?)',id,number,d.definition,d.fallback_id,c.actor.id,c.now),sql("UPDATE lk_signature_rule_drafts SET published_id=? WHERE id='installation'",id)],audit:[{action:'signature.rules.publish',summary:`Published immutable signer rules v${number}; configured packets retain their captured rules.`}]}
}
const coordinator:Handler=async(c,p)=>{
 requireRole(c.actor,['owner'],'narrow signature coordinators')
 const type=oneOf(p,'type',signatureTypes),audienceId=optionalText(p,'audienceId',100),version=integer(p,'version',0)
 const checks=[sql('COALESCE((SELECT version FROM lk_signature_coordinators WHERE type=?),0)=?',type,version)]
 if(audienceId){const check=sql("EXISTS(SELECT 1 FROM lk_intake_audiences WHERE id=? AND kind='group')",audienceId);if(!(await c.db.prepare(`SELECT ${check.sql} AS ok`).bind(...check.params).first<{ok:number}>())?.ok)fail('INVALID','Choose a recorded coordinator group.');checks.push(check)}
 return {allowed:['owner'],result:{type,version:version+1},checks,writes:[sql('INSERT INTO lk_signature_coordinators VALUES(?,?,1) ON CONFLICT(type) DO UPDATE SET audience_id=excluded.audience_id,version=version+1',type,audienceId)],audit:[{action:'signature.coordinators',summary:`Configured current coordinator membership for ${type}; agreement access is still required.`}]}
}
const availability:Handler=async(c,p)=>{
 requireRole(c.actor,may.signature,'record signer availability')
 const id=p.operatorId?text(p,'operatorId',100):c.actor.id
 if(id!==c.actor.id&&c.actor.role!=='owner')fail('FORBIDDEN','Only the owner changes another signer’s availability.',403)
 await signer(c.db,id)
 if(typeof p.away!=='boolean')fail('INVALID','away must be true or false.')
 const prior=await c.db.prepare('SELECT * FROM lk_approval_absences WHERE operator_id=?').bind(id).first<any>(),version=integer(p,'version',0)
 if((prior?.version??0)!==version)fail('STALE','Signer availability changed. Reload.',409)
 return {allowed:may.signature,result:{id,version:version+1},checks:[signerCheck(id),...(id!==c.actor.id?[sql(`(${roleSql})='owner'`,c.actor.id)]:[]),sql('COALESCE((SELECT version FROM lk_approval_absences WHERE operator_id=?),0)=?',id,version)],writes:[sql('INSERT INTO lk_approval_absences VALUES(?,?,?,1,?,?) ON CONFLICT(operator_id) DO UPDATE SET away=excluded.away,version=version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at',id,Number(p.away),prior?.delegate_id??null,c.actor.id,c.now)],audit:[{action:'signature.availability',summary:'Recorded current signer availability. Existing named approval delegates remain recorded; signer rules use their required fallback.'}]}
}
export const signatureRuleHandlers:Record<string,Handler>={'signature.rules.save':save,'signature.rules.preview':preview,'signature.rules.publish':publish,'signature.coordinators':coordinator,'signature.availability':availability}
