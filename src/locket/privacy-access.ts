import type { Ctx, Handler } from './commands'
import { requireRole, agreementAccessSql } from './access'
import { requireFullFields } from './repository-access'
import { fail, sql, text, bool, type Sql } from './model'
export interface PrivacyScope {partyIds:string[];agreementIds:string[]}
export async function privacyChecks(c:Ctx,scope:PrivacyScope):Promise<Sql[]>{
 if(c.actor.role==='owner')return []
 requireRole(c.actor,['counsel','approver','requester','viewer'],'act as a scoped privacy delegate')
 await requireFullFields(c.db,c.actor)
 if(!scope.partyIds.length)fail('FORBIDDEN','The owner must assign this privacy scope.',403)
 const access=agreementAccessSql(c.actor.id)
 const checks:Sql[]=[sql(`NOT EXISTS(SELECT 1 FROM json_each(?) selected WHERE NOT EXISTS(SELECT 1 FROM lk_privacy_scopes p WHERE p.operator_id=? AND p.party_id=selected.value))
 AND NOT EXISTS(SELECT 1 FROM json_each(?) selected LEFT JOIN lk_agreements a ON a.id=selected.value WHERE a.id IS NULL OR NOT (${access.sql}) OR NOT EXISTS(SELECT 1 FROM lk_privacy_scopes p WHERE p.party_id=a.party_id AND p.operator_id=?))`,JSON.stringify(scope.partyIds),c.actor.id,JSON.stringify([...new Set(scope.agreementIds)]),...access.params,c.actor.id)]

 for(const check of checks)if(!await c.db.prepare('SELECT 1 WHERE '+check.sql).bind(...check.params).first())fail('FORBIDDEN','This request extends beyond your current privacy scope or repository access. Ask the owner to handle it.',403)
 return checks
}
export async function authorizeErasureResult(c:Ctx,type:string,result:any){
 if(!['person.erase.preview','person.erase'].includes(type))return
 if(result.scope)await privacyChecks(c,result.scope)
 else requireRole(c.actor,['owner'],'read this historical erasure result')
 // Apply on initial delivery and idempotent replay: minimization authority never grants note-reading authority.
 if(!['owner','counsel'].includes(c.actor.role)&&Array.isArray(result.patches))result.patches=result.patches.map((patch:any)=>['lk_privileged_notes','lk_access_exceptions'].includes(patch.table)?{...patch,after:Object.fromEntries(Object.keys(patch.after).map(key=>[key,'[privileged data withheld]']))}:patch)
}
const grant:Handler=async(c,p)=>{
 requireRole(c.actor,['owner'],'assign scoped privacy authority')
 const operatorId=text(p,'operatorId',100),partyId=text(p,'partyId',100),enabled=bool(p,'enabled')
 const human=sql("EXISTS(SELECT 1 FROM oa_operators o LEFT JOIN lk_roles r ON r.operator_id=o.id WHERE o.id=? AND o.status='active' AND o.role<>'owner' AND COALESCE(r.role,'viewer')<>'agent')",operatorId)
 if(!await c.db.prepare('SELECT 1 WHERE '+human.sql).bind(...human.params).first())fail('INVALID','Choose an active human member.')
 if(!await c.db.prepare('SELECT 1 FROM lk_parties WHERE id=? AND merged_into IS NULL').bind(partyId).first())fail('NOT_FOUND','Choose a current counterparty.',404)
 return{allowed:['owner'],result:{operatorId,partyId,enabled},checks:[human],writes:[enabled?sql('INSERT INTO lk_privacy_scopes VALUES(?,?,?,?) ON CONFLICT(operator_id,party_id) DO UPDATE SET granted_by=excluded.granted_by,granted_at=excluded.granted_at',operatorId,partyId,c.actor.id,c.now):sql('DELETE FROM lk_privacy_scopes WHERE operator_id=? AND party_id=?',operatorId,partyId)],audit:[{action:'privacy.scope',summary:`Owner ${enabled?'granted':'revoked'} counterparty-scoped privacy authority for member ${operatorId}; existing repository access still applies.`}]}
}
export const privacyHandlers:Record<string,Handler>={'privacy.scope':grant}
