import { assertProviderTags } from './signature-provider-tags'
import { copiesOf,pdfBlob,providerRequest,signersOf,type ProviderPacket,type SignatureConnection,SignatureProviderFailure } from './signature-provider'
/** Native tags already belong to the reviewed PDF; sending never changes it. */
export async function sendDropbox(connection:SignatureConnection,token:string,p:ProviderPacket) {
 await assertProviderTags('dropbox-sign',p)
 const data=new FormData();data.set('title',p.title);data.set('subject',p.title);data.set('metadata[locket_packet_digest]',p.digest)
 data.set('use_text_tags','true');data.set('hide_text_tags','false')
 p.documents.forEach((d,i)=>data.set(`files[${i}]`,pdfBlob(d.bytes),d.filename))
 signersOf(p).forEach((r,i)=>{data.set(`signers[${i}][name]`,r.name);data.set(`signers[${i}][email_address]`,r.email);data.set(`signers[${i}][order]`,String(r.order-1))})
 copiesOf(p).forEach((r,i)=>data.set(`cc_email_addresses[${i}]`,r.email))
 const result=await providerRequest(connection.base_url,'/signature_request/send',token,data,'POST',true)
 const id=result.signature_request?.signature_request_id
 if(typeof id!=='string'||!id)throw new SignatureProviderFailure('uncertain','provider_receipt_missing')
 return {envelopeId:id,status:'sent' as const}
}
