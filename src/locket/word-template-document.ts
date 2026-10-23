// Preserve the OOXML package and edit only selected main-document text nodes.
// Offsets refer to the exact plain-text browser rendition, never a regex match.
import { MAX_FILE_BYTES } from './artifacts'
import { fail } from './model'
import { assertSafeWordParts } from './word-xml'
const decoder=new TextDecoder('utf-8',{fatal:true}),encoder=new TextEncoder()
const u16=(b:Uint8Array,o:number)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint16(o,true)
const u32=(b:Uint8Array,o:number)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(o,true)
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0})
const crc=(bytes:Uint8Array)=>{let n=0xffffffff;for(const b of bytes)n=table[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0}
export type WordPart={name:string;bytes:Uint8Array}
export async function readWord(bytes:Uint8Array,mode:'template'|'review'='template'):Promise<WordPart[]> {
 let end=-1
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(u32(bytes,i)===0x06054b50&&i+22+u16(bytes,i+20)===bytes.length){end=i;break}
 if(end<0||u16(bytes,end+4)||u16(bytes,end+6)||u16(bytes,end+8)!==u16(bytes,end+10))fail('DOCX','Use a single-disk DOCX package.')
 const count=u16(bytes,end+10),directory=u32(bytes,end+16),size=u32(bytes,end+12)
 if(count>2000||directory+size!==end)fail('DOCX','The DOCX directory is invalid or too large.')
 let offset=directory,total=0
 const parts:WordPart[]=[],names=new Set<string>()
 for(let i=0;i<count;i++) {
  if(offset+46>end||u32(bytes,offset)!==0x02014b50)fail('DOCX','The DOCX directory is damaged.')
  const flags=u16(bytes,offset+8),method=u16(bytes,offset+10),packed=u32(bytes,offset+20),length=u32(bytes,offset+24),nameLength=u16(bytes,offset+28),extra=u16(bytes,offset+30),comment=u16(bytes,offset+32),local=u32(bytes,offset+42)
  const name=decoder.decode(bytes.subarray(offset+46,offset+46+nameLength))
  if(flags&1||![0,8].includes(method)||!name||name.startsWith('/')||name.includes('\\')||name.split('/').includes('..')||names.has(name)||length>20*1024*1024||(total+=length)>30*1024*1024)fail('DOCX','Unsupported, encrypted, duplicate or oversized DOCX part.')
  if(local+30>directory||u32(bytes,local)!==0x04034b50||u16(bytes,local+8)!==method)fail('DOCX','The DOCX local header is invalid.')
  const start=local+30+u16(bytes,local+26)+u16(bytes,local+28)
  if(start+packed>directory||decoder.decode(bytes.subarray(local+30,local+30+u16(bytes,local+26)))!==name)fail('DOCX','The DOCX part bounds do not match.')
  let data=bytes.slice(start,start+packed)
  if(method===8){
   const reader=new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),chunks:Uint8Array[]=[];let read=0
   for(;;){const chunk=await reader.read();if(chunk.done)break;read+=chunk.value.length;if(read>length){await reader.cancel();fail('DOCX','The expanded DOCX part exceeds its declared size.')}chunks.push(chunk.value)}
   data=new Uint8Array(read);let at=0;for(const chunk of chunks){data.set(chunk,at);at+=chunk.length}
  }
  if(data.length!==length||crc(data)!==u32(bytes,offset+16))fail('DOCX','The DOCX part digest is damaged.')
  names.add(name);parts.push({name,bytes:data});offset+=46+nameLength+extra+comment
 }
 if(offset!==end||!names.has('[Content_Types].xml')||!names.has('word/document.xml'))fail('DOCX','The Word package is incomplete.')
 for(const part of parts)if(/\.(xml|rels)$/.test(part.name)){
  const xml=decoder.decode(part.bytes)
  if(mode==='template'&&/<!DOCTYPE|<!ENTITY|vbaProject|macroEnabled|TargetMode\s*=\s*["']External["']|<w:(?:del|ins|moveFrom|moveTo|fldChar|instrText|txbxContent)\b/i.test(xml))fail('DOCX_UNSUPPORTED','Remove active content, external relationships, tracked changes, fields or text boxes before authoring this template. The source was not changed.')
 }
 if(mode==='review')assertSafeWordParts(parts)
 return parts
}
export function writeWord(parts:WordPart[]):Uint8Array {
 const locals:Uint8Array[]=[],central:Uint8Array[]=[];let offset=0
 for(const part of parts){
  const name=encoder.encode(part.name),data=part.bytes,header=new Uint8Array(30),directory=new Uint8Array(46),h=new DataView(header.buffer),d=new DataView(directory.buffer),checksum=crc(data)
  h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint32(14,checksum,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true)
  d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint32(16,checksum,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true)
  locals.push(header,name,data);central.push(directory,name);offset+=header.length+name.length+data.length
 }
 const directorySize=central.reduce((n,b)=>n+b.length,0),end=new Uint8Array(22),e=new DataView(end.buffer)
 e.setUint32(0,0x06054b50,true);e.setUint16(8,parts.length,true);e.setUint16(10,parts.length,true);e.setUint32(12,directorySize,true);e.setUint32(16,offset,true)
 const result=new Uint8Array(offset+directorySize+22);let at=0
 for(const b of [...locals,...central,end]){result.set(b,at);at+=b.length}
 if(result.length>MAX_FILE_BYTES)fail('FILE_SIZE','The populated Word document exceeds the current 5 MB file limit.',413)
 return result
}
const entities:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}
const decode=(s:string)=>s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,e:string)=>e[0]==='#'?String.fromCodePoint(e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):Number(e.slice(1))):entities[e.toLowerCase()])
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
export interface WordMark {name:string;label:string;start:number;end:number;quote:string;kind:'field'|'optional';required:boolean}
export function wordModel(parts:WordPart[]) {
 const xml=decoder.decode(parts.find(p=>p.name==='word/document.xml')!.bytes),paragraphs:{xmlStart:number;xmlEnd:number;start:number;end:number;text:string;nodes:{xmlStart:number;xmlEnd:number;start:number;end:number}[]}[]=[]
 let text=''
 for(const p of xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)){
  const start=text.length,nodes=[]
  for(const n of p[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:br(?:\s[^>]*)?\/>/g)){
   if(n[1]!==undefined){const value=decode(n[1]),bodyAt=n[0].indexOf('>')+1;nodes.push({xmlStart:p.index!+n.index!+bodyAt,xmlEnd:p.index!+n.index!+n[0].lastIndexOf('</w:t>'),start:text.length,end:text.length+value.length});text+=value}
   else text+=n[0].startsWith('<w:tab')?'\t':'\n'
  }
  paragraphs.push({xmlStart:p.index!,xmlEnd:p.index!+p[0].length,start,end:text.length,text:text.slice(start),nodes});text+='\n'
 }
 if(!paragraphs.length||text.length>200000)fail('DOCX_UNSUPPORTED','The Word document needs a readable main body of at most 200,000 characters.')
 return {xml,text:text.slice(0,-1),paragraphs}
}
export function validateMarks(model:ReturnType<typeof wordModel>,marks:WordMark[]) {
 if(marks.length>120||new Set(marks.map(m=>m.name)).size!==marks.length)fail('INVALID','Use at most 120 uniquely named fields and optional clauses.')
 for(const m of marks){
  if(!/^[a-z][a-z0-9_]{0,39}$/.test(m.name)||!m.label?.trim()||m.label.length>120||!Number.isInteger(m.start)||!Number.isInteger(m.end)||m.end<=m.start||model.text.slice(m.start,m.end)!==m.quote)fail('CITATION','Select the exact current source text and a valid unique field name.')
  const paragraph=model.paragraphs.find(p=>m.start>=p.start&&m.end<=p.end)
  if(!paragraph||(m.kind==='optional'&&(m.start!==paragraph.start||m.end!==paragraph.end)))fail('WORD_SELECTION','Fields stay within one paragraph; an optional clause selects one entire paragraph.')
  if(m.kind==='field'&&!paragraph.nodes.some(n=>m.start>=n.start&&m.start<n.end))fail('WORD_SELECTION','A field must start in document text.')
  for(const other of marks)if(other!==m&&m.start<other.end&&m.end>other.start){const nested=m.kind==='optional'&&other.kind==='field'&&m.start<=other.start&&m.end>=other.end||other.kind==='optional'&&m.kind==='field'&&other.start<=m.start&&other.end>=m.end;if(!nested)fail('WORD_SELECTION','Selected fields or optional clauses overlap.')}
 }
}
export function renderWord(parts:WordPart[],marks:WordMark[],values:Record<string,unknown>,choices:Record<string,unknown>) {
 const model=wordModel(parts);validateMarks(model,marks)
 const edits:{start:number;end:number;replacement:string}[]=[],filled:Record<string,string>={},clauses:Record<string,string>={}
 for(const m of marks.filter(m=>m.kind==='optional')){const choice=choices[m.name]??'include';if(!['include','omit'].includes(String(choice)))fail('FIELDS','Choose Include or Omit for each optional clause.');clauses[m.name]=String(choice);if(choice==='omit'){const p=model.paragraphs.find(p=>p.start===m.start&&p.end===m.end)!;edits.push({start:p.xmlStart,end:p.xmlEnd,replacement:'<w:p/>'})}}
 for(const m of marks.filter(m=>m.kind==='field')){
  const omitted=marks.some(o=>o.kind==='optional'&&clauses[o.name]==='omit'&&o.start<=m.start&&o.end>=m.end)
  const value=values[m.name]??''
  if(typeof value!=='string'||value.length>4000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail('FIELDS','Word field values must be plain text of at most 4,000 characters.')
  if(!omitted&&m.required&&!value.trim())fail('FIELDS',`Fill in: ${m.label}.`,400)
  filled[m.name]=omitted?'':value
  if(omitted)continue
  const paragraph=model.paragraphs.find(p=>m.start>=p.start&&m.end<=p.end)!
  if(paragraph.nodes.filter(n=>n.end>m.start&&n.start<m.end).reduce((n,node)=>n+Math.min(m.end,node.end)-Math.max(m.start,node.start),0)!==m.end-m.start)fail('WORD_SELECTION','Select plain text without tabs or line breaks for a field.')
  for(const node of paragraph.nodes.filter(n=>n.end>m.start&&n.start<m.end)){
   const original=model.text.slice(node.start,node.end),from=Math.max(m.start,node.start)-node.start,to=Math.min(m.end,node.end)-node.start
   // Merge all replacements within this text node so two fields do not overwrite each other.
   let edit=edits.find(e=>e.start===node.xmlStart&&e.end===node.xmlEnd)
   if(!edit){edit={start:node.xmlStart,end:node.xmlEnd,replacement:original};edits.push(edit)}
  }
 }
 // Work each node from the right so source offsets remain stable, including split runs.
 for(const p of model.paragraphs)for(const node of p.nodes){const edit=edits.find(e=>e.start===node.xmlStart&&e.end===node.xmlEnd);if(!edit)continue
  let body=model.text.slice(node.start,node.end)
  for(const m of marks.filter(m=>m.kind==='field'&&m.end>node.start&&m.start<node.end&&!marks.some(o=>o.kind==='optional'&&clauses[o.name]==='omit'&&o.start<=m.start&&o.end>=m.end)).sort((a,b)=>b.start-a.start))body=body.slice(0,Math.max(m.start,node.start)-node.start)+(m.start>=node.start?filled[m.name]:'')+body.slice(Math.min(m.end,node.end)-node.start)
  edit.replacement=escape(body)
 }
 let xml=model.xml
 for(const edit of edits.sort((a,b)=>b.start-a.start))xml=xml.slice(0,edit.start)+edit.replacement+xml.slice(edit.end)
 // Replacements stay in existing runs, keeping run/paragraph/table styles and numbering.
 const output=parts.map(p=>p.name==='word/document.xml'?{...p,bytes:encoder.encode(xml.replace(/<w:t(?=\s|>)(?![^>]*xml:space)([^>]*)>/g,'<w:t xml:space="preserve"$1>'))}:p)
 return {bytes:writeWord(output),text:wordModel(output).text,fields:{values:filled,clauses}}
}
