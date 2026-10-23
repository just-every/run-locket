import { PDFDocument, StandardFonts, concatTransformationMatrix, popGraphicsState, pushGraphicsState, rgb } from 'pdf-lib'
import { fail, sha256 } from './model'
import { pdfPages, type SignatureField } from './signature-fields'
import { documentNumber, signerIndex, signersOf, type ProviderPacket, SignatureProviderFailure } from './signature-provider'

export type TextTagProvider = 'adobe-acrobat-sign' | 'dropbox-sign'
export interface ProviderTagPlacement {
 id:string; sourceAnchor?:string; tag:string; page:number; x:number; y:number; width:number; height:number
}
export interface ProviderTagDerivation {
 documentId:string; sourceSha256:string; taggedSha256:string; fields:ProviderTagPlacement[]
}
const adobeKind={signature:'signature',initials:'initials',name:'fullname',title:'title',date:'date'} as const
const dropboxKind={signature:'sig',initials:'initial',name:'text',title:'text',date:'date'} as const
const points=(value:number)=>String(Number(value.toFixed(5)))

/** The tag indexes follow the provider's recipient indexes: Adobe 1-based, Dropbox 0-based. */
export function providerTextTag(provider:TextTagProvider,p:ProviderPacket,f:SignatureField) {
 const id=`lk_d${documentNumber(p,f.documentId)}_f${p.fields.indexOf(f)+1}`,signer=signerIndex(p,f)
 return provider==='adobe-acrobat-sign'
  ?`{{*${id}_es_:signer${signer+1}:${adobeKind[f.kind]}:dimension(width=${points(f.width)}pt,height=${points(f.height)}pt)}}`
  :`[${dropboxKind[f.kind]}|req|signer${signer}|${f.kind}|${id}]`
}

/**
 * Prepare an independently retained rendition BEFORE approval, never while sending.
 * This returns new bytes and custody metadata; it never writes or mutates the source.
 * Adobe's dimension directive uses PDF points. Dropbox sizes tags from their text
 * bounds; their exact detected field bounds still require a provider detection run.
 * Sources: Adobe Text Tag Guide; Dropbox Text Tags Walkthrough.
 */
export async function prepareProviderTags(provider:TextTagProvider,p:ProviderPacket) {
 const documents:ProviderPacket['documents']=[],fields=p.fields.map(f=>({...f})),derivations:ProviderTagDerivation[]=[]
 for(const d of p.documents){
  const sourceSha256=await sha256(d.bytes)
  if(sourceSha256!==d.sha256)fail('PACKET_DIGEST','A packet source differs from its retained digest.',409)
  const selected=p.fields.filter(f=>f.documentId===d.id)
  if(!selected.length){documents.push({...d,bytes:d.bytes.slice()});continue}
  if(d.purpose!=='sign')fail('REFERENCE_FIELDS','Reference documents cannot carry signature fields.',409)
  const pdf=await PDFDocument.load(d.bytes.slice(),{updateMetadata:false,throwOnInvalidObject:true})
  const font=await pdf.embedFont(StandardFonts.Helvetica),pages=pdf.getPages(),placements:ProviderTagPlacement[]=[]
  for(const f of selected){
   const page=pages[f.page-1],media=page?.getMediaBox(),crop=page?.getCropBox()
   // The canonical preview is a PDF.js viewport. Reject nonstandard coordinate
   // spaces rather than silently applying unrotated media-box arithmetic to them.
   if(!page||!media||!crop||page.getRotation().angle%360!==0||media.x!==0||media.y!==0||crop.x!==0||crop.y!==0||crop.width!==media.width||crop.height!==media.height||Math.abs(f.pageWidth-media.width)>.01||Math.abs(f.pageHeight-media.height)>.01)
    fail('PROVIDER_TAG_GEOMETRY','Export a reviewed PDF with unrotated, full-size pages before preparing provider text tags.',409)
   if(![f.x,f.y,f.width,f.height].every(Number.isFinite)||f.x<0||f.y<0||f.width<=0||f.height<=0||f.x+f.width>f.pageWidth||f.y+f.height>f.pageHeight)
    fail('FIELD_BOUNDS','Provider text tags must fit inside their reviewed page.',409)
   const tag=providerTextTag(provider,p,f),fontSize=12
   // One literal text run, with its PDF text rectangle equal to the reviewed
   // top-left point rectangle. drawText emits Tj without kerning adjustments,
   // so sum individual advances rather than pdf-lib’s kerned string width.
   // Scaling does not change document/page geometry.
   page.pushOperators(pushGraphicsState(),concatTransformationMatrix(f.width/Array.from(tag).reduce((width,char)=>width+font.widthOfTextAtSize(char,fontSize),0),0,0,f.height/fontSize,f.x,f.pageHeight-f.y-f.height))
   page.drawText(tag,{x:0,y:0,size:fontSize,font,color:rgb(1,1,1)})
   page.pushOperators(popGraphicsState())
   fields[p.fields.indexOf(f)].anchor=tag
   placements.push({id:f.id,...(f.anchor?{sourceAnchor:f.anchor}:{}),tag,page:f.page,x:f.x,y:f.y,width:f.width,height:f.height})
  }
  // pdf-lib otherwise preserves source metadata; fixed dates make preparation
  // byte-repeatable even when called again to compute an approval context.
  pdf.setCreationDate(new Date(0));pdf.setModificationDate(new Date(0))
  const bytes=await pdf.save({useObjectStreams:false,addDefaultPage:false}),taggedSha256=await sha256(bytes)
  documents.push({...d,bytes,sha256:taggedSha256})
  derivations.push({documentId:d.id,sourceSha256,taggedSha256,fields:placements})
 }
 return {documents,fields,derivations}
}

/** Validate approved native tags before the first provider upload. No send-time rewrite. */
export async function assertProviderTags(provider:TextTagProvider,p:ProviderPacket) {
 if(p.fields.some(f=>!p.documents.some(d=>d.id===f.documentId&&d.purpose==='sign'))||signersOf(p).some((_,i)=>!p.fields.some(f=>signerIndex(p,f)===i)))
  throw new SignatureProviderFailure('rejected','provider_native_tags_required')
 for(const d of p.documents){
  if(await sha256(d.bytes)!==d.sha256)throw new SignatureProviderFailure('rejected','provider_document_digest_mismatch')
  const selected=p.fields.filter(f=>f.documentId===d.id)
  if(!selected.length)continue
  const pages=await pdfPages(d.bytes)
  for(const f of selected){
   const tag=providerTextTag(provider,p,f)
   if(f.anchor!==tag)throw new SignatureProviderFailure('rejected','provider_native_tags_required')
   const matches=pages.flatMap((page,i)=>page.items.flatMap(item=>Array.from({length:item.text.split(tag).length-1},()=>({page:i+1,item}))))
   if(matches.length!==1||matches[0].page!==f.page||Math.abs(matches[0].item.x-f.x)>.1||Math.abs(matches[0].item.y-f.y)>.1||Math.abs(matches[0].item.width-f.width)>.1||Math.abs(matches[0].item.height-f.height)>.1)
    throw new SignatureProviderFailure('rejected','provider_tag_placement_mismatch')
  }
 }
}
