import { may } from './access'
import { populate } from './agreements'
import { PDF, fileInput, isPdf, readArtifactBytes, storeArtifact } from './artifacts'
import type { Ctx, Handler } from './commands'
import { entityById, entityValues, requireEntityScope, signatoriesOf } from './entities'
import { canonical, fail, integer, json, list, object, oneOf, optionalText, sha256, sql, text, type Sql } from './model'
import { textPdf } from './pdf'
import { agreementGuards, bump, currentVersion, invalidateApprovals, requireStatus, statusAfterChange, visibleAgreement, type AgreementRow, type VersionRow } from './records'
import { fieldsForPdf, manualField, templateBlocks, type SignatureBlock, type SignatureField } from './signature-fields'
import { agreementSigner, requireCoordinator, ruleDraft, frozenSignatureRules } from './signature-rules'

export interface PacketDocument {id:string;artifactId:string;filename:string;sha256:string;purpose:'sign'|'reference';templateVersionId:string|null;blocks:SignatureBlock[]}
export interface PacketRecipient {order:number;name:string;email:string;action:'sign'|'copy';partyRole:string;signingFor:string|null}
export const packetRow=(db:D1Database,id:string)=>db.prepare('SELECT * FROM lk_signature_packets WHERE agreement_id=?').bind(id).first<any>()
export function packetRecipients(input:unknown[]):PacketRecipient[] {
 const recipients=input.map((value,i)=>{const r=object(value),address=text(r,'email',200).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))fail('INVALID','Each recipient needs a valid email address.');return {order:i+1,name:text(r,'name',200),email:address,action:oneOf(r,'action',['sign','copy'] as const),partyRole:optionalText(r,'partyRole',200)??`counterparty:${address}`,signingFor:optionalText(r,'signingFor',200)}})
 if(new Set(recipients.map(r=>r.email)).size!==recipients.length)fail('INVALID','Each packet recipient appears once.')
 if(new Set(recipients.filter(r=>r.action==='sign').map(r=>r.partyRole)).size!==recipients.filter(r=>r.action==='sign').length)fail('INVALID','Each signer needs a distinct party role.')
 return recipients
}
/** Joined into APPROVE-001 decision context by review.ts. Exact documents, template blocks and manual placements cannot change under an approval. */
export async function signaturePacketContext(db:D1Database,a:AgreementRow,v:VersionRow) {
 const row=await packetRow(db,a.id),blocks=await templateBlocks(db,v.template_version_id),rulesetId=row?row.ruleset_id:await frozenSignatureRules(db,a.id)
 if(!row&&!blocks&&!rulesetId)return null
 const documents:PacketDocument[]=row?JSON.parse(row.documents):[]
 const renditions=(await db.prepare('SELECT provider,source_digest,definition,digest FROM lk_signature_tag_renditions WHERE agreement_id=? AND version_id=? ORDER BY provider').bind(a.id,v.id).all()).results
 const artifacts=(await db.prepare("SELECT id,filename,sha256,role,media_type FROM lk_artifacts WHERE version_id=? AND role IN ('original','rendition')").bind(v.id).all<any>()).results
 const primary=artifacts.find(f=>f.role==='rendition')??artifacts.find(f=>f.role==='original'&&f.media_type===PDF)
 const mainDocument=primary?{id:'main',sha256:primary.sha256,filename:primary.filename}:v.kind==='template'&&v.text!==null&&!artifacts.some(f=>f.role==='original')?{id:'main',sha256:await sha256(textPdf(a.title,v.text,`${a.reference} v${v.number} - version digest ${v.digest.slice(0,16)}`)),filename:`${a.reference}-v${v.number}.pdf`}:null
 return {providerRenditions:renditions,mainDocument,versionId:v.id,packetVersionId:row?.version_id??v.id,revision:row?.revision??0,rulesetId,documents,fields:row?JSON.parse(row.fields):[],recipients:row?JSON.parse(row.recipients):[],mainBlocks:blocks?JSON.parse(blocks.definition):[]}
}
const configure:Handler=async(c,p)=>{
 const a=await visibleAgreement(c,p.agreementId),coordinator=await requireCoordinator(c,a)
 requireStatus(a,['draft','in_review','approved'],'change its signing packet')
 const v=await currentVersion(c,a),prior=await packetRow(c.db,a.id),revision=integer(p,'revision',0)
 if(revision!==(prior?.revision??0))fail('STALE','The signing packet changed. Reload.',409)
 const checks:Sql[]=[...agreementGuards(c,a,p),coordinator,sql('COALESCE((SELECT revision FROM lk_signature_packets WHERE agreement_id=?),0)=?',a.id,revision)]
 const documents:PacketDocument[]=[]
 for(const input of list(p,'documents',19)){
  const d=object(input),id=text(d,'artifactId',100),artifact=await c.db.prepare('SELECT * FROM lk_artifacts WHERE id=? AND agreement_id=?').bind(id,a.id).first<any>()
  if(!artifact||!['attachment'].includes(artifact.role)||artifact.media_type!==PDF)fail('PACKET_DOCUMENT','Choose a retained PDF attachment on this agreement.')
  const provenance=JSON.parse(artifact.provenance),templateId=provenance.templateVersionId??null,blocks=await templateBlocks(c.db,templateId)
  documents.push({id,artifactId:id,filename:artifact.filename,sha256:artifact.sha256,purpose:oneOf(d,'purpose',['sign','reference'] as const),templateVersionId:templateId,blocks:blocks?JSON.parse(blocks.definition):[]})
  checks.push(sql('EXISTS(SELECT 1 FROM lk_artifacts WHERE id=? AND agreement_id=? AND sha256=?)',id,a.id,artifact.sha256))
 }
 if(new Set(documents.map(d=>d.id)).size!==documents.length)fail('INVALID','Each packet document appears once.')
 const fields=list(p,'fields',100).map(manualField),recipients=packetRecipients(list(p,'recipients',20))
 const frozen=prior?prior.ruleset_id:await frozenSignatureRules(c.db,a.id),selection=await agreementSigner(c.db,a,frozen)
 if(selection){
  const internal=recipients.find(r=>r.partyRole==='internal')??recipients.find(r=>r.email===selection.person.email.toLowerCase())
  const chosen={name:selection.person.name,email:selection.person.email.toLowerCase(),action:'sign' as const,partyRole:'internal',signingFor:null}
  if(internal)Object.assign(internal,chosen);else recipients.push({order:recipients.length+1,...chosen})
  checks.push(...selection.checks)
 }
 const existing=(await c.db.prepare("SELECT id FROM lk_artifacts WHERE version_id=? AND role IN ('original','rendition')").bind(v.id).all<{id:string}>()).results
 for(const f of fields)if(f.documentId!=='main'&&!documents.some(d=>d.id===f.documentId)&&!existing.some(d=>d.id===f.documentId))fail('FIELD_DOCUMENT','Each placement must belong to a packet document.')
 for(const d of documents)await fieldsForPdf(await readArtifactBytes(c.db,d.artifactId),d.id,d.purpose==='sign'?d.blocks:[],fields.filter(f=>f.documentId===d.id))
 const mainFields=fields.filter(f=>f.documentId==='main'||existing.some(d=>d.id===f.documentId))
 if(mainFields.length){const candidates=(await c.db.prepare("SELECT * FROM lk_artifacts WHERE version_id=? AND role IN ('original','rendition')").bind(v.id).all<any>()).results,primary=candidates.find(f=>f.role==='rendition')??candidates.find(f=>f.role==='original'&&f.media_type===PDF);if(primary)await fieldsForPdf(await readArtifactBytes(c.db,primary.id),'main',[],mainFields);else if(v.kind==='template'&&v.text!==null&&!candidates.some(f=>f.role==='original'))await fieldsForPdf(textPdf(a.title,v.text,`${a.reference} v${v.number} - version digest ${v.digest.slice(0,16)}`),'main',[],mainFields);else fail('NEEDS_PDF','Attach the reviewed signing PDF before placing its fields.',409)}
 const published=await ruleDraft(c.db),rulesetId=prior?prior.ruleset_id:await frozenSignatureRules(c.db,a.id)
 checks.push(sql("(SELECT published_id FROM lk_signature_rule_drafts WHERE id='installation') IS ?",published?.published_id??null))
 const reason=text(p,'reason',1000),definition={documents,fields,recipients,rulesetId,versionId:v.id}
 return {allowed:may.signature,result:{agreementId:a.id,revision:revision+1},checks,writes:[sql('INSERT INTO lk_signature_packets VALUES(?,?,1,?,?,?,?,?,?) ON CONFLICT(agreement_id) DO UPDATE SET version_id=excluded.version_id,revision=revision+1,ruleset_id=excluded.ruleset_id,documents=excluded.documents,fields=excluded.fields,recipients=excluded.recipients,updated_by=excluded.updated_by,updated_at=excluded.updated_at',a.id,v.id,rulesetId,json(documents),json(fields),json(recipients),c.actor.id,c.now),sql('INSERT INTO lk_signature_packet_changes VALUES(?,?,?,?,?,?,?)',crypto.randomUUID(),a.id,revision+1,c.actor.id,c.now,reason,json(definition)),invalidateApprovals(c,a.id,'Signing packet documents, recipients or fields changed'),sql("UPDATE lk_packages SET status='voided',void_reason='Signing packet changed before sending' WHERE agreement_id=? AND status='prepared'",a.id),bump(c,a,'status=?',statusAfterChange(a))],audit:[{action:'signature.packet.configure',agreementId:a.id,summary:`Recorded packet revision ${revision+1}: ${reason}. Earlier approvals withdrawn.`}]}
}
/** Add an exact uploaded PDF or populate an approved text template. Word templates require a reviewed PDF attachment. */
const addDocument:Handler=async(c,p)=>{
 const a=await visibleAgreement(c,p.agreementId),coordinator=await requireCoordinator(c,a)
 requireStatus(a,['draft','in_review','approved'],'add a packet document')
 let bytes:Uint8Array,filename:string,provenance:Record<string,unknown>={kind:'signature_packet_document'},checks=[...agreementGuards(c,a,p),coordinator]
 if(p.templateVersionId){
  const id=text(p,'templateVersionId',100),t=await c.db.prepare('SELECT v.*,t.entity_id FROM lk_template_versions v JOIN lk_templates t ON t.id=v.template_id WHERE v.id=?').bind(id).first<any>()
  if(!t||t.status!=='approved')fail('TEMPLATE_NOT_APPROVED','Use an approved template version.',409)
  requireEntityScope(t.entity_id,a,'Packet template')
  const blocks=await templateBlocks(c.db,id)
  checks.push(sql("(SELECT status FROM lk_template_versions WHERE id=?)='approved'",id))
  if(await c.db.prepare('SELECT 1 FROM lk_word_templates WHERE id=?').bind(id).first()){
   if(!p.file)fail('NEEDS_PDF','Attach the reviewed PDF exported from this Word template; Locket does not convert it implicitly.',409)
   const f=fileInput(p.file);if(!isPdf(f))fail('FILE_TYPE','Packet documents must be PDFs.');bytes=f.bytes;filename=f.filename
  }else{
   const entity=await entityById(c,a.entity_id),party=await c.db.prepare('SELECT name FROM lk_parties WHERE id=?').bind(a.party_id).first<{name:string}>()
   const filled=populate(t,{...object(p.fields??{}),title:a.title,counterparty:party?.name??'',...entityValues(entity,t.body)},object(p.clauseChoices??{}),a.entity_id)
   bytes=textPdf(a.title,filled.text,`${a.reference} packet template ${t.number}`);filename=optionalText(p,'filename',200)??`attachment-${t.number}.pdf`
   provenance={...provenance,populatedFields:filled.fields}
  }
  provenance={...provenance,templateVersionId:id,blocksRevision:blocks?.revision??0}
 }else{const f=fileInput(p.file);if(!isPdf(f))fail('FILE_TYPE','Packet documents must be PDFs.');bytes=f.bytes;filename=f.filename}
 const stored=await storeArtifact({bytes,filename,mediaType:PDF},{agreementId:a.id,role:'attachment',provenance,actorId:c.actor.id,at:c.now})
 return {allowed:may.signature,result:{artifactId:stored.id,sha256:stored.sha256},checks,writes:[...stored.writes,bump(c,a)],audit:[{action:'signature.packet.document',agreementId:a.id,summary:`Retained ${filename} for explicit inclusion in a signing packet; no approval or provider send claimed.`}]}
}
export async function buildPacket(c:Ctx,a:AgreementRow,v:VersionRow,primary:{id:string;filename:string;sha256:string;bytes?:Uint8Array},inputRecipients:PacketRecipient[],signatoryEmail:string|null=null) {
 const row=await packetRow(c.db,a.id)
 if(row&&row.version_id!==v.id)fail('PACKET_VERSION','Review and save the packet against the current version before preparing it.',409)
 const captured=await ruleDraft(c.db),rulesetId=row?row.ruleset_id:await frozenSignatureRules(c.db,a.id)
 const selection=await agreementSigner(c.db,a,rulesetId)
 const recipients=row?JSON.parse(row.recipients) as PacketRecipient[]:inputRecipients
 if(selection&&!row)fail('PACKET_REVIEW','Save and review the rule-selected signer before approving this packet.',409)
 if(selection&&row&&(recipients.find(r=>r.partyRole==='internal')?.email!==selection.person.email.toLowerCase()||recipients.find(r=>r.partyRole==='internal')?.name!==selection.person.name))fail('SIGNER_CHANGED','Signer availability changed. Save the current packet to review the fallback and renew its approval.',409)
 if(!recipients.length){const party=await c.db.prepare('SELECT contacts,signatories FROM lk_parties WHERE id=?').bind(a.party_id).first<any>();const contact=party?[...JSON.parse(party.signatories??'[]'),...JSON.parse(party.contacts??'[]')][0]:null;if(contact)recipients.push({order:1,name:contact.name,email:contact.email,action:'sign',partyRole:'counterparty',signingFor:null})}
 if(selection){const internal=recipients.find(r=>r.partyRole==='internal')??recipients.find(r=>r.email===selection.person.email.toLowerCase());const chosen={name:selection.person.name,email:selection.person.email.toLowerCase(),action:'sign' as const,partyRole:'internal',signingFor:null};if(internal)Object.assign(internal,chosen);else recipients.push({order:recipients.length+1,...chosen})}
 const entity=await entityById(c,a.entity_id)
 if(entity&&!recipients.some(r=>r.partyRole==='internal')){const listed=signatoriesOf(entity),person=signatoryEmail?listed.find(s=>s.email===signatoryEmail):listed[0];if(!person)fail('SIGNATORY','Choose a recorded entity signatory.',409);const present=recipients.find(r=>r.email===person.email);if(present)Object.assign(present,{action:'sign',partyRole:'internal',signingFor:entity.legal_name});else recipients.push({order:recipients.length+1,name:person.name,email:person.email,action:'sign',partyRole:'internal',signingFor:entity.legal_name})}
 if(!recipients.some(r=>r.action==='sign'))fail('INVALID','Name at least one signer.')
 const main=await templateBlocks(c.db,v.template_version_id)
 const documents:PacketDocument[]=[{id:'main',artifactId:primary.id,filename:primary.filename,sha256:primary.sha256,purpose:'sign',templateVersionId:v.template_version_id,blocks:main?JSON.parse(main.definition):[]},...(row?JSON.parse(row.documents):[])]
 const manual:ReturnType<typeof manualField>[]=row?JSON.parse(row.fields):[],fields:SignatureField[]=[]
 for(const d of documents){
  const bytes=d.id==='main'&&primary.bytes?primary.bytes:await readArtifactBytes(c.db,d.artifactId)
  if(await sha256(bytes)!==d.sha256)fail('PACKET_DIGEST','A packet document differs from its retained digest.',409)
  const placements=manual.filter(f=>f.documentId===d.id||(d.id==='main'&&f.documentId===primary.id))
  if(d.purpose==='reference'&&placements.length)fail('REFERENCE_FIELDS','Reference documents cannot carry signature fields.')
  fields.push(...await fieldsForPdf(bytes,d.id,d.purpose==='sign'?d.blocks:[],placements))
 }
 const anchors=fields.filter(f=>f.anchor);if(new Set(anchors.map(f=>f.anchor)).size!==anchors.length)fail('ANCHOR','Use unique signature anchors across the complete packet so provider anchors cannot target the wrong document.',409)
 for(const f of fields)if(!recipients.some(r=>r.action==='sign'&&r.partyRole===f.partyRole))fail('FIELD_SIGNER',`Field ${f.id} has no signer for party role ${f.partyRole}.`,409)
 const changes=(await c.db.prepare('SELECT revision,actor_id,at,reason,definition FROM lk_signature_packet_changes WHERE agreement_id=? ORDER BY revision').bind(a.id).all()).results
 return {documents,fields,recipients:recipients.map((r,i)=>({...r,order:i+1})),signerRule:selection?{rulesetId,ruleId:selection.ruleId,signerId:selection.person.id,fallback:selection.fallback}:null,changes,packetDigest:await sha256(canonical({documents:documents.map(d=>({id:d.id,sha256:d.sha256,purpose:d.purpose})),fields,recipients})),checks:[...(selection?.checks??[]),sql('COALESCE((SELECT revision FROM lk_signature_packets WHERE agreement_id=?),0)=?',a.id,row?.revision??0),...(!row?[sql("(SELECT published_id FROM lk_signature_rule_drafts WHERE id='installation') IS ?",captured?.published_id??null)]:[])]}
}
const previewDocument:Handler=async(c,p)=>{
 const a=await visibleAgreement(c,p.agreementId),coordinator=await requireCoordinator(c,a),id=text(p,'artifactId',100)
 const artifact=await c.db.prepare("SELECT * FROM lk_artifacts WHERE id=? AND agreement_id=? AND media_type=?").bind(id,a.id,PDF).first<any>()
 if(!artifact)fail('NOT_FOUND','Choose a PDF on this agreement.',404)
 const {pdfPages}=await import('./signature-fields'),pages=await pdfPages(await readArtifactBytes(c.db,id))
 return {allowed:may.signature,result:{artifactId:id,pages:pages.map(p=>({width:p.width,height:p.height}))},checks:[...agreementGuards(c,a),coordinator],writes:[],audit:[]}
}
export const signaturePacketHandlers={'package.configure':configure,'package.document.add':addDocument,'package.document.preview':previewDocument}
