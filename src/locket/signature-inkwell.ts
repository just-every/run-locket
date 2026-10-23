import { copiesOf,documentNumber,encodeBase64,providerRequest,signerIndex,signersOf,type ProviderPacket,type SignatureConnection,SignatureProviderFailure } from './signature-provider'
/** Inkwell 6c4638762028477f6ddba6b6bd8fc18ad2fcbb04 exposes API draft preparation only.
 * It explicitly rejects sending from /api/v1/envelopes; never claim a draft was sent. */
export async function prepareInkwell(connection:SignatureConnection,token:string,p:ProviderPacket) {
 const result=await providerRequest(connection.base_url,'/api/v1/envelopes',token,{commandId:p.id,status:'draft',title:p.title,filename:'packet.pdf',documents:p.documents.map(d=>({filename:d.filename,pdfBase64:encodeBase64(d.bytes),mode:d.purpose==='reference'?'view':'sign'})),signers:signersOf(p).map(r=>({name:r.name,email:r.email,order:r.order})),copies:copiesOf(p).map(r=>({name:r.name,email:r.email})),fields:p.fields.map(f=>({id:`d${documentNumber(p,f.documentId)}_${f.id}`,label:f.kind,type:f.kind==='name'?'text':f.kind,signer:signerIndex(p,f),document:documentNumber(p,f.documentId)-1,documentPage:f.page-1,page:f.page-1,x:f.x/f.pageWidth,y:f.y/f.pageHeight,width:f.width/f.pageWidth,height:f.height/f.pageHeight,required:true}))})
 const id=result.result?.id
 if(typeof id!=='string'||!id)throw new SignatureProviderFailure('uncertain','provider_receipt_missing')
 return {envelopeId:id,status:'provider_prepared' as const}
}
