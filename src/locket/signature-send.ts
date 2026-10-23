import { requireRole } from './access'
import { readArtifactBytes } from './artifacts'
import { auditSql,commit,guardSql,type Ctx,type Handler } from './commands'
import { commandNotifications } from './notification-events'
import { workflowWrites } from './workflow-history'
import { fail,integer,Problem,sha256,sql,text,type Sql } from './model'
import { agreementGuards,bump,currentVersion,requireStatus,visibleAgreement,type AgreementRow } from './records'
import { decisionContext,routing } from './review'
import { agreementSigner,requireCoordinator } from './signature-rules'
import { liveSignatureProviders,signatureBase,signatureSecret,SignatureProviderFailure,type ProviderPacket,type SignatureConnection } from './signature-provider'
import { sendDocusign } from './signature-docusign'
import { sendAcrobat } from './signature-acrobat'
import { sendDropbox } from './signature-dropbox'
import { prepareInkwell } from './signature-inkwell'
import { oneOf,optionalText } from './model'

const configure:Handler=async(c,p)=>{
 requireRole(c.actor,['owner'],'configure a signing provider connection')
 const provider=oneOf(p,'provider',liveSignatureProviders),base=signatureBase(provider,text(p,'baseUrl',300),c.env),version=integer(p,'version',0),account=optionalText(p,'accountId',100)
 if(provider==='docusign'&&!account)fail('SIGNATURE_CONFIG','Docusign requires the connected account ID.')
 return {allowed:['owner'],result:{provider,version:version+1},checks:[sql('COALESCE((SELECT version FROM lk_signature_connections WHERE provider=?),0)=?',provider,version)],writes:[sql('INSERT INTO lk_signature_connections VALUES(?,?,?,1,?,?) ON CONFLICT(provider) DO UPDATE SET base_url=excluded.base_url,account_id=excluded.account_id,version=version+1,configured_by=excluded.configured_by,configured_at=excluded.configured_at',provider,base,account,c.actor.id,c.now)],audit:[{action:'signature.connection.configure',summary:`The owner configured ${provider}; credentials remain in the installation secret store. No send authorization was granted.`}]}
}
export async function confirmSignaturePackage(c:Ctx,a:AgreementRow,pkg:any) {
 requireStatus(a,['approved'],'send a signature packet')
 if(pkg.status!=='prepared'||pkg.version_id!==a.current_version_id)fail('NOT_CURRENT','Prepare a packet from the current approved version.',409)
 const v=await currentVersion(c,a),context=await decisionContext(c.db,a,v)
 const live=(await c.db.prepare("SELECT id,kind,deviation_id FROM lk_approvals WHERE agreement_id=? AND version_id=? AND version_digest=? AND context_digest=? AND decision='approved' AND invalidated_at IS NULL").bind(a.id,v.id,v.digest,context.digest).all<any>()).results
 const required=await routing(c.db,a)
 if(required.some(r=>!live.some(x=>x.kind===r.kind&&(x.deviation_id??null)===(r.deviationId??null))))fail('NOT_APPROVED','The exact packet’s current approvals are incomplete.',409)
 const manifest=JSON.parse(pkg.manifest)
 if(manifest.approvals.some((id:string)=>!live.some(x=>x.id===id)))fail('NOT_APPROVED','An approval recorded on this packet no longer counts.',409)
 const checks:Sql[]=[sql("EXISTS(SELECT 1 FROM lk_packages WHERE id=? AND status='prepared' AND version_digest=? AND manifest=?)",pkg.id,v.digest,pkg.manifest)]
 if(manifest.signerRule){const selection=await agreementSigner(c.db,a,manifest.signerRule.rulesetId);if(!selection||selection.person.id!==manifest.signerRule.signerId)fail('SIGNER_CHANGED','Signer availability changed. Prepare and review the packet again.',409);checks.push(...selection.checks)}
 return {manifest,checks}
}
const send:Handler=async(c,p)=>{
 requireRole(c.actor,['owner'],'authorize a provider operation for this packet')
 const a=await visibleAgreement(c,p.agreementId),coordinator=await requireCoordinator(c,a),pkg=await c.db.prepare('SELECT * FROM lk_packages WHERE id=? AND agreement_id=?').bind(text(p,'packageId',100),a.id).first<any>()
 if(!pkg)fail('NOT_FOUND','No package on this agreement.',404)
 const {manifest,checks}=await confirmSignaturePackage(c,a,pkg),connection=await c.db.prepare('SELECT * FROM lk_signature_connections WHERE provider=?').bind(pkg.provider).first<SignatureConnection>()
 if(!connection)fail('SIGNATURE_CONFIG','The owner must configure this provider connection first.',503)
 const mode=p.mode??'send'
 if(pkg.provider==='inkwell'&&mode!=='prepare')fail('INKWELL_SEND_UNAVAILABLE','Inkwell’s public API prepares drafts only. Prepare a draft and review/send it in Inkwell; automatic API sending is pending there.',409)
 if(p.consent!==true||p.manifestDigest!==await sha256(pkg.manifest)||p.connectionVersion!==connection.version)fail('SEND_CONSENT','Explicitly confirm this exact manifest digest and connection revision for this operation.',409)
 signatureBase(pkg.provider,connection.base_url,c.env);signatureSecret(c.env,pkg.provider)
 const noPrior=sql('NOT EXISTS(SELECT 1 FROM lk_signature_dispatches WHERE package_id=?)',pkg.id)
 if(await c.db.prepare('SELECT 1 FROM lk_signature_dispatches WHERE package_id=?').bind(pkg.id).first())fail('ALREADY_SENT','This package already has a provider operation. Inspect its outcome; it cannot be retried automatically.',409)
 if(!manifest.documents?.length)fail('PACKET_REQUIRED','Prepare a current packet manifest before using a provider connection.',409)
 for(const document of manifest.documents.filter((d:any)=>d.purpose==='sign'))for(const recipient of manifest.recipients.filter((r:any)=>r.action==='sign'))if(!manifest.fields.some((f:any)=>f.documentId===document.id&&f.partyRole===recipient.partyRole&&f.kind==='signature'))fail('SIGNATURE_FIELDS',`Place a signature for ${recipient.name} on ${document.filename} before using a provider connection.`,409)
 return {allowed:['owner'],result:{id:c.commandId,packageId:pkg.id,status:'queued'},checks:[...agreementGuards(c,a,p),coordinator,...checks,sql('(SELECT version FROM lk_signature_connections WHERE provider=?)=?',pkg.provider,connection.version),noPrior],writes:[sql("INSERT INTO lk_signature_dispatches(id,agreement_id,package_id,agreement_version,actor_id,connection_version,manifest_digest,status,created_at) VALUES(?,?,?,?,?,?,?,'queued',?)",c.commandId,a.id,pkg.id,a.version+1,c.actor.id,connection.version,p.manifestDigest,c.now),bump(c,a)],audit:[{action:'signature.provider.requested',agreementId:a.id,summary:`The owner explicitly authorized one ${pkg.provider==='inkwell'?'draft preparation':'send'} of the reviewed packet digest ${manifest.packetDigest}; queued is not sent.`}]}
}
/** Run after the command transaction. The one-use claim rechecks live authority, access, packet approval and connection. */
export async function dispatchSignature(c:Ctx,id:string=c.commandId) {
 const row=await c.db.prepare('SELECT * FROM lk_signature_dispatches WHERE id=?').bind(id).first<any>()
 if(!row||row.status!=='queued')return
 const attempt=crypto.randomUUID()
 let claimed=false
 const finish=async(status:string,envelopeId:string|null,code:string|null)=>{
  const previous=claimed?'sending':'queued',audit=auditSql(c,{action:`signature.provider.${status}`,agreementId:row.agreement_id,summary:`Provider operation ${status}${envelopeId?'; provider receipt '+envelopeId:''}. ${status==='provider_prepared'?'Draft only; send and signing remain unconfirmed.':status==='sent'?'The provider accepted the send; completion remains unconfirmed.':'No automatic retry.'}`})
  const statements=[sql(`INSERT INTO lk_audit SELECT ${audit.params.map(()=>'?').join(',')} WHERE EXISTS(SELECT 1 FROM lk_signature_dispatches WHERE id=? AND status=? AND attempt_id IS ?)`,...audit.params,id,previous,claimed?attempt:null),sql('UPDATE lk_signature_dispatches SET status=?,envelope_id=?,outcome_code=? WHERE id=? AND status=? AND attempt_id IS ?',status,envelopeId,code,id,previous,claimed?attempt:null)]
  if(status==='sent'){
   const transition={...c,now:Date.now()},event={action:'package.sent',agreementId:row.agreement_id,summary:'The provider accepted the exact reviewed signing packet; completion remains unconfirmed.'}
   const history=await workflowWrites(transition,[event]),notifications=await commandNotifications(transition,'package.sent',{agreementId:row.agreement_id},{allowed:['owner'],result:{status:'sent'},writes:[],audit:[event]})
   statements.push(sql("UPDATE lk_packages SET status='sent',envelope_id=?,sent_by=?,sent_at=? WHERE id=?",envelopeId,row.actor_id,transition.now,row.package_id),sql("UPDATE lk_agreements SET status='out_for_signature',version=version+1,updated_at=? WHERE id=?",transition.now,row.agreement_id),...history,...notifications)
  }
  const guard=crypto.randomUUID()
  try{await c.db.batch([guardSql(guard,[sql('EXISTS(SELECT 1 FROM lk_signature_dispatches WHERE id=? AND status=? AND attempt_id IS ?)',id,previous,claimed?attempt:null)]),...statements,sql('DELETE FROM lk_guard WHERE id=?',guard)].map(s=>c.db.prepare(s.sql).bind(...s.params)))}catch(error){if(!/LOCKET_GUARD/.test(String(error)))throw error}
 }
 let packet:ProviderPacket,connection:SignatureConnection,token:string
 try{
  if(c.actor.id!==row.actor_id)fail('FORBIDDEN','Only the requesting owner may dispatch this packet.',403)
  const a=await visibleAgreement(c,row.agreement_id),coordinator=await requireCoordinator(c,a)
  if(a.version!==row.agreement_version)fail('STALE','The agreement changed after send authorization.',409)
  const pkg=await c.db.prepare('SELECT * FROM lk_packages WHERE id=? AND agreement_id=?').bind(row.package_id,a.id).first<any>()
  if(!pkg||await sha256(pkg.manifest)!==row.manifest_digest)fail('STALE','The packet manifest changed.',409)
  const approved=await confirmSignaturePackage(c,a,pkg)
  connection=(await c.db.prepare('SELECT * FROM lk_signature_connections WHERE provider=?').bind(pkg.provider).first<SignatureConnection>())!
  if(!connection||connection.version!==row.connection_version)fail('STALE','The provider connection changed.',409)
  signatureBase(pkg.provider,connection.base_url,c.env);token=signatureSecret(c.env,pkg.provider)
  packet={id:row.id,title:a.title,digest:approved.manifest.packetDigest,fields:approved.manifest.fields,recipients:approved.manifest.recipients,documents:[]}
  for(const document of approved.manifest.documents){const bytes=await readArtifactBytes(c.db,document.artifactId);if(await sha256(bytes)!==document.sha256)fail('PACKET_DIGEST','A document no longer matches the approved packet.',409);packet.documents.push({...document,bytes})}
  await commit(c,['owner'],[...agreementGuards(c,a),coordinator,...approved.checks,sql('(SELECT version FROM lk_signature_connections WHERE provider=?)=?',pkg.provider,connection.version),sql("EXISTS(SELECT 1 FROM lk_signature_dispatches WHERE id=? AND status='queued')",id)],[sql("UPDATE lk_signature_dispatches SET status='sending',attempt_id=?,attempted_at=? WHERE id=? AND status='queued'",attempt,Date.now(),id)])
 }catch(error){if(!(error instanceof Problem))throw error;return finish('cancelled',null,'authority_packet_or_connection_changed')}
 const own=await c.db.prepare('SELECT attempt_id FROM lk_signature_dispatches WHERE id=?').bind(id).first<{attempt_id:string}>()
 if(own?.attempt_id!==attempt)return
 claimed=true
 try{
  const result=connection.provider==='docusign'?await sendDocusign(connection,token,packet):connection.provider==='adobe-acrobat-sign'?await sendAcrobat(connection,token,packet):connection.provider==='dropbox-sign'?await sendDropbox(connection,token,packet):await prepareInkwell(connection,token,packet)
  return finish(result.status,result.envelopeId,null)
 }catch(error){return finish(error instanceof SignatureProviderFailure?error.outcome:'uncertain',null,error instanceof SignatureProviderFailure?error.code:'provider_outcome_unknown')}
}
export const signatureSendHandlers={'signature.connection.configure':configure,'package.send':send}
