import { getDocumentProxy, getResolvedPDFJS } from 'unpdf'
import { fail } from './model'

type Matrix = number[]
type Point = [number, number]
interface Font { fontMatrix?:number[]; vertical?:boolean; isType3Font?:boolean; isInvalidPDFjsFont?:boolean }
interface TextState {
 ctm:Matrix; matrix:Matrix; x:number; y:number; lineX:number; lineY:number
 font:Font|null; size:number; scale:number; charSpacing:number; wordSpacing:number; rise:number; leading:number; unsupported?:string
}
interface GlyphBox { start:number; end:number; x:number; y:number; right:number; bottom:number; unsupported?:string }
interface Run { text:string; glyphs:GlyphBox[]; cursor:Point; top:number; height:number }
export interface PdfAnchorMatch { anchor:string; x:number; y:number; width:number; height:number; unsupported?:string }
export interface PdfAnchorPage { width:number; height:number; matches:PdfAnchorMatch[] }
type PdfPage = Awaited<ReturnType<Awaited<ReturnType<typeof getDocumentProxy>>['getPage']>>
const identity=()=>[1,0,0,1,0,0]
const multiply=(a:Matrix,b:ArrayLike<number>):Matrix=>[
 a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],
 a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5],
]
const point=(m:Matrix,x:number,y:number):Point=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]
const near=(a:number,b:number)=>Math.abs(a-b)<.0001

/** Replay only text positioning. Glyph widths and TJ adjustments come from the PDF,
 * never from browser fonts or a proportional share of a combined text item. */
async function textRuns(page:PdfPage,viewport:Matrix):Promise<Run[]> {
 const {OPS,AnnotationMode}=await getResolvedPDFJS()
 const operators=await page.getOperatorList({annotationMode:AnnotationMode.DISABLE})
 let state:TextState={ctm:identity(),matrix:identity(),x:0,y:0,lineX:0,lineY:0,font:null,size:0,scale:1,charSpacing:0,wordSpacing:0,rise:0,leading:0}
 const stack:TextState[]=[],runs:Run[]=[],fonts=new Map<string,Font>()
 let previous:Run|undefined
 const save=()=>stack.push({...state,ctm:[...state.ctm],matrix:[...state.matrix]})
 const restore=()=>{const saved=stack.pop();if(!saved)throw new Error('Unbalanced PDF graphics state');state=saved}
 const setFont=async(ref:string,size:number)=>{
  let font=fonts.get(ref)
  if(!font){font=await new Promise<Font>(resolve=>page.commonObjs.get(ref,resolve));fonts.set(ref,font)}
  state.font=font;state.size=size
 }
 for(let index=0;index<operators.fnArray.length;index++){
  const args=operators.argsArray[index]??[]
  switch(operators.fnArray[index]){
   case OPS.save:save();break
   case OPS.restore:restore();break
   case OPS.transform:state.ctm=multiply(state.ctm,args);break
   case OPS.paintFormXObjectBegin:
    save();if(args[0])state.ctm=multiply(state.ctm,args[0])
    // A Form's clipping bounds require visibility analysis, beyond text positioning.
    if(args[1])state.unsupported='clipped Form text'
    break
   case OPS.paintFormXObjectEnd:restore();break
   case OPS.beginGroup:save();state.unsupported='transparency-group text';break
   case OPS.endGroup:restore();break
   case OPS.clip:case OPS.eoClip:state.unsupported='clipped text';break
   case OPS.beginText:state.matrix=identity();state.x=state.y=state.lineX=state.lineY=0;break
   case OPS.setTextMatrix:
    // PDF.js 6 packs Tm into one Float32Array argument.
    state.matrix=Array.from(args[0]);state.x=state.y=state.lineX=state.lineY=0;break
   case OPS.moveText:state.x=state.lineX+=args[0];state.y=state.lineY+=args[1];break
   case OPS.setLeadingMoveText:
    state.leading=-args[1];state.x=state.lineX+=args[0];state.y=state.lineY+=args[1];break
   case OPS.nextLine:state.x=state.lineX;state.y=state.lineY-=state.leading;break
   case OPS.setFont:await setFont(args[0],args[1]);break
   case OPS.setGState:
    for(const [name,value] of args[0]){
     if(name==='Font')await setFont(value[0],value[1])
     if(name==='SMask'&&value)state.unsupported='masked text'
    }
    break
   case OPS.setHScale:state.scale=args[0]/100;break
   case OPS.setCharSpacing:state.charSpacing=args[0];break
   case OPS.setWordSpacing:state.wordSpacing=args[0];break
   case OPS.setTextRise:state.rise=args[0];break
   case OPS.setLeading:state.leading=args[0];break
   case OPS.showText:{
    const {font,size,scale}=state
    if(!font)throw new Error('Text has no font')
    const matrix=multiply(viewport,multiply(state.ctm,state.matrix)),direction=size<0?-1:1,fontSize=Math.abs(size)
    const reason=state.unsupported??(font.vertical?'vertical text':font.isType3Font?'Type3 text':font.isInvalidPDFjsFont?'invalid font':
     size<=0||scale<=0||(font.fontMatrix?.[0]??.001)<=0?'nonstandard font scaling':
     !near(matrix[1],0)||!near(matrix[2],0)||matrix[0]<=0||matrix[3]>=0?'rotated, skewed or mirrored text':undefined)
    const cursor=point(matrix,state.x,state.y+state.rise),top=point(matrix,state.x,state.y+state.rise+fontSize)[1],height=Math.abs(matrix[3]*fontSize)
    let run=previous
    if(!run||!near(run.cursor[0],cursor[0])||!near(run.cursor[1],cursor[1])||!near(run.top,top)||!near(run.height,height)){
     run={text:'',glyphs:[],cursor,top,height};runs.push(run)
    }
    for(const glyph of args[0]){
     if(typeof glyph==='number'){
      if(font.vertical)state.y-=glyph*fontSize/1000
      else state.x-=glyph*fontSize*scale*direction/1000
      continue
     }
     // PDF.js uses the PDF default 0.001-em font matrix when a font omits it.
     const unit=fontSize*(font.fontMatrix?.[0]??.001),advance=glyph.width*unit*scale*direction
     const origin=point(matrix,state.x,state.y+state.rise),end=point(matrix,state.x+advance,state.y+state.rise)
     const upper=point(matrix,state.x,state.y+state.rise+size),upperEnd=point(matrix,state.x+advance,state.y+state.rise+size)
     const start=run.text.length,unicode=glyph.unicode??''
     run.text+=unicode
     if(unicode)run.glyphs.push({start,end:run.text.length,x:Math.min(origin[0],end[0],upper[0],upperEnd[0]),y:Math.min(origin[1],end[1],upper[1],upperEnd[1]),right:Math.max(origin[0],end[0],upper[0],upperEnd[0]),bottom:Math.max(origin[1],end[1],upper[1],upperEnd[1]),unsupported:reason??(!Number.isFinite(advance)||glyph.width<0?'invalid glyph advance':undefined)})
     const spacing=state.charSpacing+(glyph.isSpace?state.wordSpacing:0)
     if(font.vertical)state.y+=(glyph.vmetric?.[0]??0)*unit+spacing*direction
     else state.x+=advance+spacing*scale
    }
    run.cursor=point(matrix,state.x,state.y+state.rise);previous=run
    break
   }
  }
 }
 return runs
}

function matchesForRun(run:Run,anchor:string):PdfAnchorMatch[] {
 const matches:PdfAnchorMatch[]=[]
 if(!anchor)return matches
 for(let start=run.text.indexOf(anchor);start!==-1;start=run.text.indexOf(anchor,start+1)){
  const end=start+anchor.length,glyphs=run.glyphs.filter(g=>g.start<end&&g.end>start),first=glyphs[0],last=glyphs.at(-1)!
  const unsupported=glyphs.find(g=>g.unsupported)?.unsupported??(first.start!==start||last.end!==end?'an anchor inside a multi-character glyph':undefined)
  const x=Math.min(...glyphs.map(g=>g.x)),y=Math.min(...glyphs.map(g=>g.y))
  matches.push({anchor,x,y,width:Math.max(...glyphs.map(g=>g.right))-x,height:Math.max(...glyphs.map(g=>g.bottom))-y,unsupported})
 }
 return matches
}

export async function pdfAnchorPages(bytes:Uint8Array,anchors:string[]):Promise<PdfAnchorPage[]> {
 try{
  const pdf=await getDocumentProxy(bytes.slice(),{useWasm:false,useSystemFonts:false,disableFontFace:true,stopAtErrors:true,verbosity:0})
  try{
   const pages:PdfAnchorPage[]=[]
   for(let n=1;n<=pdf.numPages;n++){
    const page=await pdf.getPage(n),viewport=page.getViewport({scale:1}),runs=await textRuns(page,viewport.transform)
    pages.push({width:viewport.width,height:viewport.height,matches:[...new Set(anchors)].flatMap(anchor=>runs.flatMap(run=>matchesForRun(run,anchor)))})
   }
   return pages
  }finally{await pdf.loadingTask.destroy()}
 }catch{fail('PDF_FIELDS','This PDF cannot be read for field placement. Attach a readable reviewed PDF.',409)}
}
