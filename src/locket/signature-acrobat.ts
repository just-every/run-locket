import { assertProviderTags } from './signature-provider-tags'
import { copiesOf,pdfBlob,providerRequest,signersOf,type ProviderPacket,type SignatureConnection,SignatureProviderFailure } from './signature-provider'
/** Upload exactly the reviewed tagged PDFs, then explicitly transition AUTHORING to IN_PROCESS. */
export async function sendAcrobat(connection:SignatureConnection,token:string,p:ProviderPacket) {
 await assertProviderTags('adobe-acrobat-sign',p)
 const fileInfos=[]
 for(const d of p.documents){const form=new FormData();form.set('File',pdfBlob(d.bytes),d.filename);const uploaded=await providerRequest(connection.base_url,'/transientDocuments',token,form);if(typeof uploaded.transientDocumentId!=='string')throw new SignatureProviderFailure('uncertain','provider_upload_receipt_missing');fileInfos.push({transientDocumentId:uploaded.transientDocumentId,label:d.id})}
 const created=await providerRequest(connection.base_url,'/agreements',token,{name:p.title,fileInfos,signatureType:'ESIGN',state:'AUTHORING',externalId:{id:p.id},participantSetsInfo:signersOf(p).map((r,i)=>({name:`signer_${i+1}`,memberInfos:[{email:r.email,name:r.name}],order:r.order,role:'SIGNER'})),ccs:copiesOf(p).map(r=>({email:r.email}))})
 if(typeof created.id!=='string'||!created.id)throw new SignatureProviderFailure('uncertain','provider_receipt_missing')
 const path=`/agreements/${encodeURIComponent(created.id)}`
 await providerRequest(connection.base_url,path+'/state',token,{state:'IN_PROCESS'},'PUT')
 return {envelopeId:created.id,status:'sent' as const}
}
