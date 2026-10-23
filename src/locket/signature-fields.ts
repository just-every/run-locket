import { getDocumentProxy } from 'unpdf'
import { may, requireRole } from './access'
import type { Handler } from './commands'
import { fail, integer, json, list, object, oneOf, optionalText, sql, text } from './model'
import { pdfAnchorPages } from './pdf-text-geometry'

export const fieldKinds=['signature','name','title','date','initials'] as const
export type FieldKind=typeof fieldKinds[number]
export interface SignatureBlock {id:string;kind:FieldKind;partyRole:string;anchor:string;width:number;height:number}
export interface SignatureField {id:string;documentId:string;kind:FieldKind;partyRole:string;anchor?:string;page:number;x:number;y:number;width:number;height:number;pageWidth:number;pageHeight:number}
const dimension=(p:Record<string,unknown>,key:string,defaultValue:number)=>p[key]===undefined?defaultValue:integer(p,key,1,500)
export const templateBlocks=(db:D1Database,id:string|null)=>id?db.prepare('SELECT * FROM lk_signature_template_blocks WHERE template_version_id=?').bind(id).first<any>():Promise.resolve(null)
const blocks:Handler=async(c,p)=>{
 requireRole(c.actor,may.library,'author template signature blocks')
 const id=text(p,'templateVersionId',100),revision=integer(p,'revision',0)
 const t=await c.db.prepare('SELECT * FROM lk_template_versions WHERE id=?').bind(id).first<any>()
 if(!t)fail('NOT_FOUND','Choose a template version.',404)
 if(t.status!=='draft')fail('STATUS','Signature blocks belong to draft template versions. Create a new version before changing an approved template.',409)
 const definition=list(p,'blocks',100).map(value=>{
  const r=object(value),anchor=text(r,'anchor',160)
  if(!t.body.includes(anchor))fail('ANCHOR','Each signature block anchor must occur in the template body.')
  if(t.body.split(anchor).length!==2)fail('ANCHOR','Use a unique anchor for each template signature block.')
  return {id:text(r,'id',80),kind:oneOf(r,'kind',fieldKinds),partyRole:text(r,'partyRole',200),anchor,width:dimension(r,'width',150),height:dimension(r,'height',24)}
 })
 if(new Set(definition.map(b=>b.id)).size!==definition.length||new Set(definition.map(b=>b.anchor)).size!==definition.length)fail('INVALID','Signature block identities and anchors must be unique.')
 return {allowed:may.library,result:{templateVersionId:id,revision:revision+1},checks:[sql("(SELECT status FROM lk_template_versions WHERE id=?)='draft'",id),sql('COALESCE((SELECT revision FROM lk_signature_template_blocks WHERE template_version_id=?),0)=?',id,revision)],writes:[sql('INSERT INTO lk_signature_template_blocks VALUES(?,?,1,?,?) ON CONFLICT(template_version_id) DO UPDATE SET definition=excluded.definition,revision=revision+1,recorded_by=excluded.recorded_by,recorded_at=excluded.recorded_at',id,json(definition),c.actor.id,c.now)],audit:[{action:'signature.template.blocks',summary:'Recorded signature, name, title, date and initials blocks against a draft template version.'}]}
}
export async function pdfPages(bytes:Uint8Array) {
 try {
  const pdf=await getDocumentProxy(bytes.slice(),{useWasm:false,useSystemFonts:false,disableFontFace:true,stopAtErrors:true,verbosity:0})
  const pages:{width:number;height:number;items:{text:string;x:number;y:number;width:number;height:number}[]}[]=[]
  try {for(let n=1;n<=pdf.numPages;n++){
   const page=await pdf.getPage(n),viewport=page.getViewport({scale:1}),content=await page.getTextContent({disableNormalization:true})
   pages.push({width:viewport.width,height:viewport.height,items:content.items.flatMap(item=>{
    if(!('str' in item))return []
    const [x,y]=viewport.convertToViewportPoint(item.transform[4],item.transform[5])
    return [{text:item.str,x,y:y-Math.abs(item.height),width:Math.abs(item.width),height:Math.abs(item.height)}]
   })})
  }}finally{await pdf.loadingTask.destroy()}
  return pages
 }catch{fail('PDF_FIELDS','This PDF cannot be read for field placement. Attach a readable reviewed PDF.',409)}
}
/** Coordinates are top-left PDF points, normalized to every provider in its adapter. Originals are never modified. */
export async function fieldsForPdf(bytes:Uint8Array,documentId:string,blocks:SignatureBlock[],manual:unknown[]):Promise<SignatureField[]> {
 if(!blocks.length&&!manual.length)return []
 const anchorPages=blocks.length?await pdfAnchorPages(bytes,blocks.map(b=>b.anchor)):[]
 const pages=blocks.length?anchorPages:await pdfPages(bytes),fields:SignatureField[]=[]
 for(const b of blocks){
  const matches=anchorPages.flatMap((p,i)=>p.matches.flatMap(item=>item.anchor===b.anchor?[{p,i,item}]:[]))
  if(matches.length!==1)fail('ANCHOR',`Signature anchor ${b.anchor} must occur exactly once in the reviewed PDF.`,409)
  const {p,i,item}=matches[0]
  if(item.unsupported)fail('ANCHOR_GEOMETRY',`Signature anchor ${b.anchor} uses ${item.unsupported}. Place this field manually on the reviewed PDF.`,409)
  fields.push({id:b.id,documentId,kind:b.kind,partyRole:b.partyRole,anchor:b.anchor,page:i+1,x:item.x,y:item.y,width:b.width,height:b.height,pageWidth:p.width,pageHeight:p.height})
 }
 for(const input of manual){
  const f=object(input),page=integer(f,'page',1,pages.length),p=pages[page-1]
  fields.push({id:text(f,'id',80),documentId,kind:oneOf(f,'kind',fieldKinds),partyRole:text(f,'partyRole',200),page,x:integer(f,'x',0,Math.floor(p.width)),y:integer(f,'y',0,Math.floor(p.height)),width:dimension(f,'width',150),height:dimension(f,'height',24),pageWidth:p.width,pageHeight:p.height})
 }
 for(const f of fields)if(f.x<0||f.y<0||f.x+f.width>f.pageWidth||f.y+f.height>f.pageHeight)fail('FIELD_BOUNDS',`Field ${f.id} must fit inside page ${f.page}.`)
 if(new Set(fields.map(f=>f.id)).size!==fields.length)fail('INVALID','Each document field needs a unique identity.')
 return fields
}
export function manualField(value:unknown) {
 const f=object(value)
 return {id:text(f,'id',80),documentId:text(f,'documentId',100),kind:oneOf(f,'kind',fieldKinds),partyRole:text(f,'partyRole',200),page:integer(f,'page',1,1000),x:integer(f,'x',0,14400),y:integer(f,'y',0,14400),width:dimension(f,'width',150),height:dimension(f,'height',24),...(optionalText(f,'anchor',160)?{anchor:text(f,'anchor',160)}:{})}
}
export const signatureFieldHandlers={'template.signature.blocks':blocks}
