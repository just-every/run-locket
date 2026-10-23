// A small, non-evaluating XML tree. Untouched tags, whitespace and processing
// instructions serialize verbatim; no document package is rebuilt from text.
import { fail } from './model'
import type { WordPart } from './word-template-document'

export const WORD_NS='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
export const REL_NS='http://schemas.openxmlformats.org/package/2006/relationships'
export const encoder=new TextEncoder()
const decoder=new TextDecoder('utf-8',{fatal:true})
export interface XmlNode { name:string; attrs:Record<string,string>; children:XmlNode[]; parent?:XmlNode; open:string; close:string; raw?:string }
export const local=(name:string)=>name.slice(name.indexOf(':')+1)
export function namespace(node:XmlNode,name=node.name):string {
 const prefix=name.includes(':')?name.split(':')[0]:''
 for(let at:XmlNode|undefined=node;at;at=at.parent){const value=at.attrs[prefix?`xmlns:${prefix}`:'xmlns'];if(value!==undefined)return value}
 return ''
}
export const isWord=(node:XmlNode,name?:string)=>!!node.name&&namespace(node)===WORD_NS&&(!name||local(node.name)===name)
export const elements=(node:XmlNode)=>node.children.filter(n=>!!n.name)
export function walk(node:XmlNode):XmlNode[]{return [node,...node.children.flatMap(walk)]}
export function xmlText(node:XmlNode):string {return node.raw!==undefined?(node.raw.startsWith('<')?'':unescapeXml(node.raw)):node.children.map(xmlText).join('')}
export function escapeXml(value:string):string{return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
export function unescapeXml(value:string):string {
 const entities:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}
 if(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/.test(value))fail('DOCX_XML','The Word XML contains an invalid entity.')
 return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/g,(_,code:string)=>{
  if(code[0]!=='#')return entities[code]
  const n=code[1]==='x'?parseInt(code.slice(2),16):Number(code.slice(1))
  if(!Number.isInteger(n)||n>0x10ffff||n===0||n>=0xd800&&n<=0xdfff||n<32&&![9,10,13].includes(n))fail('DOCX_XML','The Word XML contains an invalid character.')
  return String.fromCodePoint(n)
 })
}
export function parseXml(bytes:Uint8Array|string):XmlNode {
 const source=typeof bytes==='string'?bytes:decoder.decode(bytes)
 if(/<!DOCTYPE|<!ENTITY/i.test(source)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(source))fail('DOCX_XML','Active declarations and control characters are not supported in Word XML.')
 const root:XmlNode={name:'',attrs:{},children:[],open:'',close:''},stack=[root]
 const tokens=source.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[^<>]*?(?:"[^"]*"|'[^']*')*[^<>]*?>|[^<]+/g)??[]
 if(tokens.join('')!==source)fail('DOCX_XML','The Word XML is malformed.')
 for(const token of tokens){
  const parent=stack[stack.length-1]
  if(token.startsWith('</')){const name=token.slice(2,-1).trim();if(stack.length===1||parent.name!==name)fail('DOCX_XML','The Word XML has mismatched tags.');parent.close=token;stack.pop();continue}
  if(!token.startsWith('<')||token.startsWith('<!--')||token.startsWith('<?')){if(!token.startsWith('<'))unescapeXml(token);parent.children.push({name:'',attrs:{},children:[],open:'',close:'',raw:token,parent});continue}
  if(token.startsWith('<!'))fail('DOCX_XML','Unsupported Word XML declaration.')
  const match=/^<([A-Za-z_][\w.:-]*)([\s\S]*?)\/?\s*>$/.exec(token)
  if(!match)fail('DOCX_XML','The Word XML has an invalid tag.')
  const attrs:Record<string,string>={},body=match![2];let position=0
  const pattern=/\s+([A-Za-z_][\w.:-]*)\s*=\s*("[^"]*"|'[^']*')/gy
  while(position<body.length){pattern.lastIndex=position;const attr=pattern.exec(body);if(!attr){if(body.slice(position).trim())fail('DOCX_XML','The Word XML has an invalid attribute.');break}if(Object.hasOwn(attrs,attr[1]))fail('DOCX_XML','The Word XML has duplicate attributes.');attrs[attr[1]]=unescapeXml(attr[2].slice(1,-1));position=pattern.lastIndex}
  const node:XmlNode={name:match![1],attrs,children:[],parent,open:token,close:''};parent.children.push(node)
  if(!/\/\s*>$/.test(token))stack.push(node)
  if(stack.length>160)fail('DOCX_XML','The Word XML is nested too deeply.')
 }
 if(stack.length!==1||elements(root).length!==1||root.children.some(n=>n.raw!==undefined&&!n.raw.startsWith('<')&&n.raw.trim()))fail('DOCX_XML','The Word XML needs one complete root element.')
 return root
}
export function serializeXml(node:XmlNode):string {
 if(node.raw!==undefined)return node.raw
 if(!node.name)return node.children.map(serializeXml).join('')
 if(node.children.length&&/\/\s*>$/.test(node.open))return node.open.replace(/\/\s*>$/, '>')+node.children.map(serializeXml).join('')+`</${node.name}>`
 return node.open+node.children.map(serializeXml).join('')+node.close
}
export function setAttrs(node:XmlNode,attrs:Record<string,string>):void {
 node.attrs=attrs;node.open=`<${node.name}${Object.entries(attrs).map(([k,v])=>` ${k}="${escapeXml(v)}"`).join('')}${node.close||node.children.length?'>':'/>'}`
}
export function attr(node:XmlNode,name:string):string|undefined {return Object.entries(node.attrs).find(([key])=>local(key)===name&&!key.startsWith('xmlns'))?.[1]}
export function wordAttr(node:XmlNode,name:string):string|undefined {return Object.entries(node.attrs).find(([key])=>key.includes(':')&&local(key)===name&&namespace(node,key)===WORD_NS)?.[1]}
export function makeXml(name:string,attrs:Record<string,string>={},children:XmlNode[]=[]):XmlNode {
 const node:XmlNode={name,attrs,children,open:'',close:children.length?`</${name}>`:''};for(const child of children)child.parent=node;setAttrs(node,attrs);return node
}
export const textXml=(value:string):XmlNode=>({name:'',attrs:{},children:[],open:'',close:'',raw:escapeXml(value)})
export function cloneXml(node:XmlNode):XmlNode {const copy={...node,attrs:{...node.attrs},children:node.children.map(cloneXml),parent:undefined};for(const child of copy.children)child.parent=copy;return copy}
export function replaceXml(node:XmlNode,replacement:XmlNode[]):void {
 if(!node.parent)fail('DOCX_XML','Cannot replace the XML root.')
 const parent=node.parent!,index=parent.children.indexOf(node);if(index<0)fail('DOCX_XML','The XML tree is inconsistent.')
 for(const child of replacement)child.parent=parent;parent.children.splice(index,1,...replacement)
}
export function appendXml(parent:XmlNode,node:XmlNode):void {node.parent=parent;parent.children.push(node)}
export function rootXml(tree:XmlNode):XmlNode{return elements(tree)[0]}
export function ensureWordPrefix(tree:XmlNode):void {const root=rootXml(tree);if(root.attrs['xmlns:w']&&root.attrs['xmlns:w']!==WORD_NS)fail('DOCX_XML','The w namespace is bound to a different vocabulary.');if(!root.attrs['xmlns:w'])setAttrs(root,{...root.attrs,'xmlns:w':WORD_NS})}
export function partXml(parts:WordPart[],name:string):XmlNode {const part=parts.find(p=>p.name===name);if(!part)fail('DOCX','The Word package is missing a required part.');return parseXml(part!.bytes)}
export function withXml(parts:WordPart[],name:string,tree:XmlNode):WordPart[]{const bytes=encoder.encode(serializeXml(tree));return parts.some(p=>p.name===name)?parts.map(p=>p.name===name?{name,bytes}:p):[...parts,{name,bytes}]}

// Internal targets are resolved relative to the source part, never the process
// filesystem. Reject traversal and every external relationship, including links.
export function relationshipTarget(relsName:string,target:string):string {
 if(/[\\\u0000-\u0020]/.test(target)||/^[A-Za-z][\w+.-]*:/.test(target)||target.startsWith('//')||/[?#]/.test(target))fail('DOCX_UNSUPPORTED','External or malformed Word relationships are not supported.')
 const source=relsName==='_rels/.rels'?'':relsName.replace(/\/\_rels\/([^/]+)\.rels$/, '/$1')
 const base=target.startsWith('/')?[]:source.split('/').slice(0,-1)
 for(const bit of target.split('/')){if(!bit||bit==='.')continue;if(bit==='..'){if(!base.length)fail('DOCX_UNSUPPORTED','A Word relationship escapes the package.');base.pop()}else base.push(bit)}
 return base.join('/')
}
export function assertSafeWordParts(parts:WordPart[]):void {
 const safeField=(instruction:string)=>{
  const command=instruction.trim().match(/^(?:[A-Za-z]+|=)/)?.[0].toUpperCase()
  if(!command||!['PAGE','NUMPAGES','SECTION','SECTIONPAGES','DATE','TIME','CREATEDATE','SAVEDATE','PRINTDATE','AUTHOR','LASTSAVEDBY','TITLE','SUBJECT','KEYWORDS','COMMENTS','FILENAME','FILESIZE','DOCPROPERTY','DOCVARIABLE','REF','PAGEREF','NOTEREF','SEQ','STYLEREF','TOC','TOA','INDEX','XE','TC','IF','=','QUOTE','SYMBOL','ADVANCE','EQ','AUTONUM','AUTONUMLGL','AUTONUMOUT','MERGEFIELD','FORMTEXT','FORMCHECKBOX','FORMDROPDOWN'].includes(command))fail('DOCX_UNSUPPORTED','The Word document contains an unsupported or external field instruction.')
 }
 for(const part of parts){
  if(/(?:vbaProject|activeX|embeddings|webextensions)\//i.test(part.name)||/\.(?:exe|dll|js|vbs|html?|mht)$/i.test(part.name)||/\.bin$/i.test(part.name)&&!/^word\/printerSettings\/[^/]+\.bin$/i.test(part.name))fail('DOCX_UNSUPPORTED','Active or embedded objects are not supported in Word review.')
  if(!/\.(?:xml|rels)$/i.test(part.name))continue
  const tree=parseXml(part.bytes)
  const fields:{instruction:string;separated:boolean}[]=[]
  for(const node of walk(tree)){
   if(node.name&&['object','OLEObject','altChunk','control','attachedTemplate','subDoc'].includes(local(node.name)))fail('DOCX_UNSUPPORTED','Active or embedded objects are not supported in Word review.')
   if(local(node.name)==='Relationship'){
    if((attr(node,'TargetMode')??'').toLowerCase()==='external')fail('DOCX_UNSUPPORTED','External Word relationships are not supported.')
    const target=attr(node,'Target');if(target)relationshipTarget(part.name,target)
    if(/(?:oleObject|package|aFChunk|attachedTemplate|control|vbaProject|externalLink)$/i.test(attr(node,'Type')??''))fail('DOCX_UNSUPPORTED','Active or embedded relationships are not supported in Word review.')
   }
   if(local(node.name)==='Override'||local(node.name)==='Default')if(/macroEnabled|vbaProject|oleObject|activeX/i.test(attr(node,'ContentType')??''))fail('DOCX_UNSUPPORTED','Macro-enabled Word content is not supported.')
   if(isWord(node,'fldSimple'))safeField(wordAttr(node,'instr')??'')
   if(isWord(node,'fldChar')){
    const type=wordAttr(node,'fldCharType')
    if(type==='begin')fields.push({instruction:'',separated:false})
    else if(type==='separate'){const field=fields[fields.length-1];if(!field)fail('DOCX_UNSUPPORTED','A Word field has no opening marker.');safeField(field.instruction);field.separated=true}
    else if(type==='end'){const field=fields.pop();if(!field)fail('DOCX_UNSUPPORTED','A Word field has no opening marker.');if(!field!.separated)safeField(field!.instruction)}
    else fail('DOCX_UNSUPPORTED','A Word field marker is invalid.')
   }
   if(isWord(node,'instrText')||isWord(node,'delInstrText')){const field=fields[fields.length-1];if(!field||field.separated)fail('DOCX_UNSUPPORTED','A Word field instruction has no valid field context.');field.instruction+=xmlText(node)}
  }
  if(fields.length)fail('DOCX_UNSUPPORTED','A Word field is incomplete.')
 }
}
