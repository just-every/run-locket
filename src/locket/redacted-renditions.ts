// Redaction is a human-produced file, separately approved by counsel.
import { requireRole } from './access'
import { fileInput, isPdf, isDocx, storeArtifact } from './artifacts'
import type { Handler } from './commands'
import { fail, integer, json, list, oneOf, sql, text, type Actor } from './model'
import { agreementGuards, visibleAgreement } from './records'
import { policyVersionCheck, repositoryPolicy } from './repository-access'

const upload:Handler=async(c,p)=>{
 requireRole(c.actor,['owner','counsel'],'upload a redacted rendition')
 const a=await visibleAgreement(c,p.agreementId),versionId=text(p,'versionId',100),originalId=text(p,'originalId',100)
 const original=await c.db.prepare("SELECT f.* FROM lk_artifacts f JOIN lk_versions v ON v.id=f.version_id WHERE f.id=? AND f.version_id=? AND v.agreement_id=? AND f.role='original'").bind(originalId,versionId,a.id).first<any>()
 if(!original)fail('NOT_FOUND','Choose an original file belonging to this version.',404)
 const file=fileInput(p.file)
 if(!isPdf(file)&&!isDocx(file))fail('FILE_TYPE','Upload a redacted PDF or DOCX.',415)
 const body=text(p,'text',400000),id=crypto.randomUUID()
 const stored=await storeArtifact(file,{agreementId:a.id,versionId,role:'attachment',provenance:{kind:'human_redaction',originalId,originalSha256:original.sha256},actorId:c.actor.id,at:c.now})
 return {allowed:['owner','counsel'],result:{id,artifactId:stored.id,originalSha256:original.sha256,renditionSha256:stored.sha256,revision:1},checks:agreementGuards(c,a,p),writes:[...stored.writes,sql('INSERT INTO lk_redacted_renditions(id,agreement_id,version_id,original_id,artifact_id,original_sha256,rendition_sha256,text) VALUES(?,?,?,?,?,?,?,?)',id,a.id,versionId,originalId,stored.id,original.sha256,stored.sha256,body)],audit:[{action:'rendition.upload',agreementId:a.id,summary:json({id,originalSha256:original.sha256,renditionSha256:stored.sha256})}]}
}
const approve:Handler=async(c,p)=>{
 requireRole(c.actor,['counsel'],'approve a redacted rendition')
 const a=await visibleAgreement(c,p.agreementId),id=text(p,'id',100),revision=integer(p,'revision',1)
 const row=await c.db.prepare('SELECT * FROM lk_redacted_renditions WHERE id=? AND agreement_id=?').bind(id,a.id).first<any>()
 if(!row)fail('NOT_FOUND','Choose a rendition belonging to this agreement.',404)
 if(row.revision!==revision)fail('STALE','This rendition approval changed. Reload first.',409)
 const roles=list(p,'roles',4).map(v=>oneOf({v},'v',['viewer','requester','approver','agent'] as const))
 if(!roles.length||new Set(roles).size!==roles.length)fail('INVALID','Choose distinct roles for this rendition.')
 const policy=await repositoryPolicy(c.db)
 if(roles.some(role=>!policy.hiddenFields.some(h=>h.role===role&&h.fields.length)))fail('INVALID','Choose roles with hidden fields in the current policy.')
 return {allowed:['counsel'],result:{id,revision:revision+1},checks:[...agreementGuards(c,a,p),policyVersionCheck(policy.version),sql('(SELECT revision FROM lk_redacted_renditions WHERE id=?)=?',id,revision)],writes:[sql('UPDATE lk_redacted_renditions SET roles=?,policy_version=?,approved_by=?,approved_at=?,revision=revision+1 WHERE id=?',json(roles),policy.version,c.actor.id,c.now,id)],audit:[{action:'rendition.approve',agreementId:a.id,summary:json({id,roles,originalSha256:row.original_sha256,renditionSha256:row.rendition_sha256,policyVersion:policy.version})}]}
}
export const redactedRenditionHandlers:Record<string,Handler>={'rendition.upload':upload,'rendition.approve':approve}

/** The caller intersects these rows with current agreement visibility. A new
 * version withholds every rendition until the current version is approved. */
export async function approvedRenditions(db:D1Database,actor:Actor){
 return (await db.prepare(`SELECT r.* FROM lk_redacted_renditions r JOIN lk_agreements a ON a.id=r.agreement_id
 WHERE r.approved_by IS NOT NULL AND r.policy_version=COALESCE((SELECT version FROM lk_repository_policy WHERE id='installation'),0)
 AND EXISTS(SELECT 1 FROM json_each(r.roles) WHERE value=?)
 AND EXISTS(SELECT 1 FROM lk_redacted_renditions current WHERE current.version_id=a.current_version_id
 AND current.approved_by IS NOT NULL AND current.policy_version=r.policy_version
 AND EXISTS(SELECT 1 FROM json_each(current.roles) WHERE value=?))
 ORDER BY r.approved_at DESC,r.id`).bind(actor.role,actor.role).all<any>()).results
}
