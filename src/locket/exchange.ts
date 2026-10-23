// Explicit, scoped disclosure to a counterparty. Default audiences are internal.
import type { Bindings } from '../auth.server'
import { fullReaders, requireRole, authority, visibleSql } from './access'
import { DOCX, storeArtifact } from './artifacts'
import { auditSql, commit, type Ctx, type Handler } from './commands'
import { externalDocx, type ExternalComment } from './exchange-document'
import { externalWord } from './word-review'
import { fail, integer, json, sha256, sql, text, type Actor, type Sql } from './model'
import { agreementGuards, currentVersion, requireStatus, visibleAgreement } from './records'
import { policyVersionCheck, repositoryPolicy, requireFullFields } from './repository-access'

export interface ExchangeRow {
  id: string; agreement_id: string; version_id: string; party_id: string; version_digest: string; artifact_id: string; token_hash: string; reply_token_hash: string | null
  sender_id: string; sender_session_id: string; sender_operator_version: number
  recipient_name: string; recipient_email: string; contact_consent: string
  expires_at: number; revoked_at: number | null; created_at: number; opened_at: number | null
  channel: 'link' | 'email'; status: string; provider: string | null; provider_message_id: string | null
  attempt_id: string | null; revision: number
}
export const tokenDigest = async (token: unknown) => {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) fail('EXCHANGE_UNAVAILABLE', 'This exchange is unavailable or has expired.', 404)
  return sha256(token)
}
// Purpose separation prevents an inbound reply capability from opening the link.
// HMAC keeps raw capabilities out of durable command results and complete archives.
export async function exchangeTokens(c:Ctx){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(c.env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign'])
  const make=async(purpose:string)=>[...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('locket-exchange:'+purpose+':'+c.commandId+':'+c.actor.sessionId)))].map(n=>n.toString(16).padStart(2,'0')).join('')
  return {token:await make('link'),replyToken:await make('reply')}
}
export async function exchangeResult(c:Ctx,result:unknown){
  const row=await c.db.prepare('SELECT * FROM lk_exchanges WHERE id=?').bind(c.commandId).first<ExchangeRow>()
  if(!row||row.sender_id!==c.actor.id||row.sender_session_id!==c.actor.sessionId)fail('EXCHANGE_UNAVAILABLE','This exchange is unavailable.',404)
  await commit(c,fullReaders,exchangeChecks(row,Date.now()),[])
  return {...result as Record<string,unknown>,...await exchangeTokens(c)}
}
export function senderActor(row: ExchangeRow): Actor {
  return {id:row.sender_id,name:'Exchange sender',email:'',role:'owner',sessionId:row.sender_session_id,operatorVersion:row.sender_operator_version}
}
/** Rechecked inside every public batch. Revoking the sender session/role/access,
 * the version audience or the exchange removes the delegated capability. */
export function exchangeChecks(row: ExchangeRow, now: number): Sql[] {
  return [
    authority(senderActor(row), fullReaders), visibleSql(senderActor(row), row.agreement_id),
    sql("EXISTS(SELECT 1 FROM lk_agreements a JOIN lk_parties p ON p.id=a.party_id,json_each(p.contacts) contact WHERE a.id=? AND a.party_id=? AND p.merged_into IS NULL AND lower(json_extract(contact.value,'$.email'))=lower(?))",row.agreement_id,row.party_id,row.recipient_email),
    sql('EXISTS(SELECT 1 FROM lk_exchanges WHERE id=? AND token_hash=? AND revoked_at IS NULL AND expires_at>? AND revision=?)', row.id, row.token_hash, now, row.revision),
    sql("EXISTS(SELECT 1 FROM lk_versions v JOIN lk_version_audiences side ON side.version_id=v.id WHERE v.id=? AND v.agreement_id=? AND v.digest=? AND side.audience='external')", row.version_id, row.agreement_id, row.version_digest),
  ]
}
export async function externalComments(db: D1Database, versionId: string): Promise<ExternalComment[]> {
  return (await db.prepare("SELECT c.id,c.body,c.quote FROM lk_comments c JOIN lk_comment_audiences side ON side.comment_id=c.id WHERE c.version_id=? AND side.audience='external' ORDER BY c.at,c.id").bind(versionId).all<ExternalComment>()).results
}
const setAudience: Handler = async (c, p) => {
  requireRole(c.actor, fullReaders, 'choose what may be shared with counterparties')
  const a = await visibleAgreement(c, p.agreementId)
  const audience = p.audience
  if (audience !== 'internal' && audience !== 'external') fail('INVALID', 'Choose internal or external.')
  const isComment = typeof p.commentId === 'string'
  const id = text(p, isComment ? 'commentId' : 'versionId', 100)
  const table = isComment ? 'lk_comment_audiences' : 'lk_version_audiences', column = isComment ? 'comment_id' : 'version_id'
  const record = await c.db.prepare(`SELECT id FROM ${isComment ? 'lk_comments' : 'lk_versions'} WHERE id=? AND agreement_id=?`).bind(id, a.id).first()
  if (!record) fail('NOT_FOUND', 'That record is not on this agreement.', 404)
  if (audience === 'external' && p.confirmExternal !== true) fail('CONSENT', 'Review the text and explicitly confirm it may be shown externally.')
  return {allowed:fullReaders,result:{id,audience},checks:agreementGuards(c,a,p),writes:[
    sql(`INSERT INTO ${table}(${column},audience,revision,changed_by,changed_at) VALUES(?,?,1,?,?) ON CONFLICT(${column}) DO UPDATE SET audience=excluded.audience,revision=${table}.revision+1,changed_by=excluded.changed_by,changed_at=excluded.changed_at`,id,audience,c.actor.id,c.now),
    // Withdrawing any external content invalidates frozen outgoing renditions.
    ...(audience === 'internal' ? [sql(`UPDATE lk_exchanges SET revoked_at=?,revision=revision+1 WHERE agreement_id=? AND revoked_at IS NULL${isComment ? ' AND version_id=(SELECT version_id FROM lk_comments WHERE id=?)' : ' AND version_id=?'}`,c.now,a.id,id)] : []),
    sql('UPDATE lk_agreements SET version=version+1,updated_at=? WHERE id=?',c.now,a.id),
  ],audit:[{action:isComment?'comment.audience':'version.audience',agreementId:a.id,summary:`Marked ${isComment?'comment':'document version'} ${audience}; an external designation is explicit disclosure permission.`}]}
}
const send: Handler = async (c, p) => {
  requireRole(c.actor, fullReaders, 'share a counterparty exchange')
  await requireFullFields(c.db,c.actor)
  const a = await visibleAgreement(c,p.agreementId)
  requireStatus(a,['draft','in_review','approved','imported'],'share a negotiation version')
  const v = await currentVersion(c,a)
  if (p.versionId !== v.id) fail('NOT_CURRENT','Choose the current version before sharing.',409)
  if (!v.text?.trim()) fail('NO_TEXT','Add readable document text before sharing.',409)
  const side = await c.db.prepare("SELECT revision FROM lk_version_audiences WHERE version_id=? AND audience='external'").bind(v.id).first<{revision:number}>()
  if (!side) fail('INTERNAL_VERSION','Explicitly mark this version external before sharing.',409)
  const rendition=p.rendition??'plain'
  if(!['plain','word-clean','word-redline'].includes(String(rendition)))fail('INVALID','Choose a plain, clean Word or redline Word rendition.')
  if (p.confirmCleanRendition !== true) fail('CONSENT','Review and approve the outgoing rendition. Internal comments and document metadata are removed; only explicitly external Locket comments are included. Word outputs preserve formatting and redact revision author metadata; a redline still contains deleted text.')
  const recipientEmail = text(p,'recipientEmail',200).toLowerCase(), consent = text(p,'contactConsent',1000)
  const party = await c.db.prepare('SELECT contacts,version FROM lk_parties WHERE id=? AND merged_into IS NULL').bind(a.party_id).first<{contacts:string;version:number}>()
  const contact = party && JSON.parse(party.contacts).find((person:{email:string})=>person.email.toLowerCase()===recipientEmail)
  if (!contact) fail('RECIPIENT','Choose a recorded contact on this agreement’s counterparty.')
  const expiry = integer(p,'expiresAt',c.now+60_000,c.now+30*86_400_000)
  if (p.channel !== 'email' && p.channel !== 'link') fail('INVALID','Choose email or secure link.')
  if (p.channel === 'email' && c.env.AUTH_LOCAL !== 'true' && (c.env as {RER_DEMO?:string}).RER_DEMO !== '1' && (!c.env.POSTMARK_SERVER_TOKEN || !c.env.MAIL_FROM)) fail('MAIL_UNAVAILABLE','Configure Postmark and a sender address before emailing an exchange.',503)
  if(p.token!==undefined)fail('INVALID','Exchange capabilities are generated by the server; omit token.')
  const tokens=await exchangeTokens(c),hash = await tokenDigest(tokens.token),replyHash=await tokenDigest(tokens.replyToken), id = c.commandId, comments = await externalComments(c.db,v.id)
  const artifact = await storeArtifact({filename:`external-v${v.number}.docx`,mediaType:DOCX,bytes:rendition==='plain'?externalDocx(v.text,comments):await externalWord(c,v.id,rendition==='word-clean')},{agreementId:a.id,versionId:v.id,role:'attachment',provenance:{exchangeId:id,external:true,plainRendition:rendition==='plain',rendition},actorId:c.actor.id,at:c.now})
  return {allowed:fullReaders,result:{id,status:p.channel==='email'?'queued':'ready',expiresAt:expiry,artifactDigest:artifact.sha256},checks:[
    ...agreementGuards(c,a,p),sql('(SELECT revision FROM lk_version_audiences WHERE version_id=?)=?',v.id,side.revision),
    sql('(SELECT version FROM lk_parties WHERE id=?)=?',a.party_id,party!.version),
    sql('(SELECT digest FROM lk_versions WHERE id=?)=?',v.id,v.digest),
    sql("(SELECT json_group_array(json_object('id',c.id,'body',c.body,'quote',c.quote)) FROM (SELECT c.id,c.body,c.quote FROM lk_comments c JOIN lk_comment_audiences s ON s.comment_id=c.id WHERE c.version_id=? AND s.audience='external' ORDER BY c.at,c.id) c)=?",v.id,json(comments)),
  ],writes:[...artifact.writes,sql('INSERT INTO lk_exchanges(id,agreement_id,version_id,party_id,version_digest,artifact_id,token_hash,sender_id,sender_session_id,sender_operator_version,recipient_name,recipient_email,contact_consent,expires_at,created_at,channel,status,reply_token_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,a.id,v.id,a.party_id,v.digest,artifact.id,hash,c.actor.id,c.actor.sessionId,c.actor.operatorVersion,contact.name,recipientEmail,consent,expiry,c.now,p.channel,p.channel==='email'?'queued':'ready',replyHash)],audit:[{action:'exchange.sent',agreementId:a.id,summary:`Authorized ${p.channel==='email'?'an email request':'a secure link'} for external version ${v.number}; explicit recorded-contact disclosure consent retained; clean rendition SHA-256 ${artifact.sha256}.`}]}
}
const revoke: Handler = async(c,p)=>{
  requireRole(c.actor,fullReaders,'revoke an exchange')
  const a=await visibleAgreement(c,p.agreementId),id=text(p,'exchangeId',100),reason=text(p,'reason',1000)
  const row=await c.db.prepare('SELECT revision FROM lk_exchanges WHERE id=? AND agreement_id=? AND revoked_at IS NULL').bind(id,a.id).first<{revision:number}>()
  if(!row)fail('NOT_FOUND','No active exchange is on this agreement.',404)
  return {allowed:fullReaders,result:{id},checks:[...agreementGuards(c,a,p),sql('(SELECT revision FROM lk_exchanges WHERE id=?)=?',id,row.revision)],writes:[sql('UPDATE lk_exchanges SET revoked_at=?,revision=revision+1 WHERE id=?',c.now,id)],audit:[{action:'exchange.revoked',agreementId:a.id,summary:`Revoked a counterparty exchange: ${reason}`}]}
}
export const exchangeHandlers:Record<string,Handler>={'exchange.send':send,'exchange.revoke':revoke,'version.audience':setAudience,'comment.audience':setAudience}
export async function exchangeList(env:Bindings,actor:Actor,agreementId:string){
  requireRole(actor,fullReaders,'read counterparty exchanges');await requireFullFields(env.DB,actor)
  const c:Ctx={env,db:env.DB,actor,now:Date.now(),commandId:crypto.randomUUID()}
  const a=await visibleAgreement(c,agreementId),policy=await repositoryPolicy(c.db)
  const rows=(await c.db.prepare('SELECT id,version_id,recipient_name,recipient_email,expires_at,revoked_at,created_at,opened_at,channel,status,provider,provider_message_id FROM lk_exchanges WHERE agreement_id=? ORDER BY created_at DESC').bind(a.id).all()).results
  const versions=(await c.db.prepare("SELECT v.id,COALESCE(s.audience,'internal') audience FROM lk_versions v LEFT JOIN lk_version_audiences s ON s.version_id=v.id WHERE v.agreement_id=?").bind(a.id).all()).results
  const comments=(await c.db.prepare("SELECT c.id,COALESCE(s.audience,'internal') audience FROM lk_comments c LEFT JOIN lk_comment_audiences s ON s.comment_id=c.id WHERE c.agreement_id=?").bind(a.id).all()).results
  await commit(c,fullReaders,[...agreementGuards(c,a),policyVersionCheck(policy.version)],a.restricted?[auditSql(c,{action:'agreement.view',agreementId:a.id,summary:'Read restricted agreement counterparty exchange records.'})]:[])
  return {rows,versions,comments}
}
