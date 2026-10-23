import { PDF,readArtifactBytes,storeArtifact } from './artifacts'
import type { Ctx,Handler } from './commands'
import { canonical,fail,json,oneOf,sha256,sql } from './model'
import { textPdf } from './pdf'
import { agreementGuards,bump,currentVersion,invalidateApprovals,requireStatus,statusAfterChange,visibleAgreement,type AgreementRow,type VersionRow } from './records'
import { buildPacket } from './signature-packets'
import { prepareProviderTags } from './signature-provider-tags'
import { requireCoordinator } from './signature-rules'
import { may } from './access'

export const taggedPackets=(db:D1Database,id:string)=>db.prepare('SELECT * FROM lk_signature_tag_renditions WHERE agreement_id=?').bind(id).all<any>()
export async function signingPrimary(c:Pick<Ctx,'db'>,a:AgreementRow,v:VersionRow){
 const files=(await c.db.prepare("SELECT * FROM lk_artifacts WHERE version_id=? AND role IN ('original','rendition')").bind(v.id).all<any>()).results
 const f=files.find(f=>f.role==='rendition')??files.find(f=>f.role==='original'&&f.media_type===PDF)
 if(f)return {id:f.id,filename:f.filename,sha256:f.sha256,bytes:await readArtifactBytes(c.db,f.id)}
 if(v.kind==='template'&&v.text!==null&&!files.some(f=>f.role==='original')){
  const bytes=textPdf(a.title,v.text,`${a.reference} v${v.number} - version digest ${v.digest.slice(0,16)}`)
  return {id:'main',filename:`${a.reference}-v${v.number}.pdf`,sha256:await sha256(bytes),bytes}
 }
 fail('NEEDS_PDF','Attach the exact reviewed signing PDF before preparing native provider tags.',409)
}
const prepare:Handler=async(c,p)=>{
 const a=await visibleAgreement(c,p.agreementId),coordinator=await requireCoordinator(c,a)
 requireStatus(a,['draft','in_review','approved'],'prepare provider-tagged PDFs for approval')
 const provider=oneOf(p,'provider',['adobe-acrobat-sign','dropbox-sign'] as const),v=await currentVersion(c,a),primary=await signingPrimary(c,a,v)
 const source=await buildPacket(c,a,v,primary,[]),input={id:a.id,title:a.title,digest:source.packetDigest,documents:await Promise.all(source.documents.map(async d=>({...d,bytes:d.id==='main'?primary.bytes:await readArtifactBytes(c.db,d.artifactId)}))),fields:source.fields,recipients:source.recipients}
 const prepared=await prepareProviderTags(provider,input),writes=[]
 const documents=[]
 for(const d of prepared.documents){
  const derivation=prepared.derivations.find(x=>x.documentId===d.id)
  if(!derivation){documents.push(source.documents.find(x=>x.id===d.id)!);continue}
  const saved=await storeArtifact({filename:`${provider}-${d.filename}`,mediaType:PDF,bytes:d.bytes},{agreementId:a.id,versionId:v.id,role:'package',provenance:{kind:'provider_tagged_pdf',provider,...derivation},actorId:c.actor.id,at:c.now})
  writes.push(...saved.writes);const {bytes:_,...metadata}=d
  documents.push({...metadata,artifactId:saved.id,filename:`${provider}-${d.filename}`,sha256:saved.sha256})
 }
 const definition={documents,fields:prepared.fields,derivations:prepared.derivations},digest=await sha256(canonical(definition))
 return {allowed:may.signature,result:{provider,digest},checks:[...agreementGuards(c,a,p),coordinator,...source.checks],writes:[...writes,sql('INSERT INTO lk_signature_tag_renditions VALUES(?,?,?,?,?,?,?) ON CONFLICT(agreement_id,provider) DO UPDATE SET version_id=excluded.version_id,source_digest=excluded.source_digest,definition=excluded.definition,digest=excluded.digest,prepared_at=excluded.prepared_at',a.id,provider,v.id,source.packetDigest,json(definition),digest,c.now),invalidateApprovals(c,a.id,'Provider-tagged PDF bytes prepared for review'),bump(c,a,'status=?',statusAfterChange(a))],audit:[{action:'signature.tags.prepare',agreementId:a.id,summary:`Retained exact ${provider} tag renditions for review and renewed approval; source originals remain unchanged. No provider request made.`}]}
}
export const signatureTagHandlers={'package.tags.prepare':prepare}
