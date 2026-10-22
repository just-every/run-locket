import type { Ctx } from './commands'
import { fail, sql, type Sql } from './model'

/** SQL form is shared by user commands and background dispatch claims. A new
 * family member, moved source or corrected confirmed term invalidates consent. */
function familyClearExpression(agreementExpression:string):string {
 return `NOT EXISTS (
  SELECT 1 FROM lk_family_analyses fa
  WHERE NOT EXISTS(SELECT 1 FROM lk_family_analyses newer WHERE newer.root_id=fa.root_id AND newer.revision>fa.revision)
  AND (fa.root_id IN (WITH RECURSIVE ancestors(id,parent_id) AS (
    SELECT id,parent_id FROM lk_agreements WHERE id=${agreementExpression} UNION ALL SELECT a.id,a.parent_id FROM lk_agreements a JOIN ancestors x ON a.id=x.parent_id
   ) SELECT id FROM ancestors) OR EXISTS(SELECT 1 FROM json_each(fa.facts,'$.members') m WHERE json_extract(m.value,'$.id')=${agreementExpression}))
  AND (fa.status!='resolved'
   OR EXISTS(SELECT 1 FROM json_each(fa.facts,'$.members') m LEFT JOIN lk_agreements a ON a.id=json_extract(m.value,'$.id')
    WHERE a.id IS NULL OR a.current_version_id IS NOT json_extract(m.value,'$.versionId') OR a.parent_id IS NOT json_extract(m.value,'$.parentId') OR a.relation IS NOT json_extract(m.value,'$.relation') OR a.status IS NOT json_extract(m.value,'$.status') OR a.timezone IS NOT json_extract(m.value,'$.timezone'))
   OR (WITH RECURSIVE descendants(id) AS (SELECT fa.root_id UNION ALL SELECT a.id FROM lk_agreements a JOIN descendants d ON a.parent_id=d.id) SELECT COUNT(*) FROM descendants)!=json_array_length(fa.facts,'$.members')
   OR EXISTS(SELECT 1 FROM json_each(fa.facts,'$.terms') t LEFT JOIN lk_terms v ON v.id=json_extract(t.value,'$.id')
    WHERE v.id IS NULL OR v.status!='confirmed' OR v.key IS NOT json_extract(t.value,'$.key') OR v.value IS NOT json_extract(t.value,'$.value') OR v.agreement_id IS NOT json_extract(t.value,'$.agreementId'))
   OR (SELECT COUNT(*) FROM lk_terms t WHERE t.status='confirmed' AND t.agreement_id IN (SELECT json_extract(m.value,'$.id') FROM json_each(fa.facts,'$.members') m))!=json_array_length(fa.facts,'$.terms')
  ))`
}
export function familyClear(agreementId:string):Sql {
 return sql(familyClearExpression('?'),agreementId,agreementId)
}
export function familySelectionClear(agreementIds:string[]):Sql {
 return sql(`NOT EXISTS(SELECT 1 FROM json_each(?) selected WHERE NOT (${familyClearExpression('selected.value')}))`,JSON.stringify(agreementIds))
}
export async function requireFamilyClear(c:Ctx, agreementId:string) {
 const check=familyClear(agreementId)
 if(!(await c.db.prepare(`SELECT (${check.sql}) AS ok`).bind(...check.params).first<{ok:number}>())?.ok)
  fail('FAMILY_BLOCKED','Counsel must resolve the current family analysis before acting on derived deadlines or obligations.',409)
 return check
}
export async function familyCommandChecks(c:Ctx,type:string,p:Record<string,unknown>):Promise<Sql[]> {
 if(!/^(renewal\.decide|renewal\.workflow\.open|notice\.(prepare|source|agent\.prepare|approve|schedule|sent|email|letter)|obligation\.update)$/.test(type))return []
 let id=typeof p.agreementId==='string'?p.agreementId:null
 if(!id&&typeof p.renewalId==='string')id=(await c.db.prepare('SELECT agreement_id FROM lk_renewals WHERE id=?').bind(p.renewalId).first<any>())?.agreement_id
 if(!id&&typeof p.noticeId==='string')id=(await c.db.prepare('SELECT agreement_id FROM lk_notices WHERE id=?').bind(p.noticeId).first<any>())?.agreement_id
 if(!id&&typeof p.briefId==='string')id=(await c.db.prepare('SELECT agreement_id FROM lk_renewal_briefs WHERE id=?').bind(p.briefId).first<any>())?.agreement_id
 return id?[await requireFamilyClear(c,id)]:[]
}
