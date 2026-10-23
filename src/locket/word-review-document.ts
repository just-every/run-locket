// Review operates on the original OPC parts. Only document markup, explicitly
// replaced comments, and explicitly removed private metadata are rewritten.
import { fail } from './model'
import type { WordPart } from './word-template-document'
import { WORD_NS, REL_NS, type XmlNode, appendXml, assertSafeWordParts, attr, cloneXml, elements, ensureWordPrefix, isWord, local, makeXml, namespace, partXml, relationshipTarget, replaceXml, rootXml, serializeXml, setAttrs, textXml, walk, withXml, wordAttr, xmlText } from './word-xml'

export interface WordReviewChange {id:string;kind:'insertion'|'deletion'|'moveFrom'|'moveTo'|'formatting';author:string;date:string|null;start:number;end:number;before:string;after:string}
export interface WordReviewComment {id:string;author:string;date:string|null;body:string;start:number;end:number;quote:string;parentId?:string|null}
interface Range {start:number;end:number}
interface Segment extends Range {node:XmlNode;run?:XmlNode;paragraph:XmlNode;value:string}
interface ReviewModel {tree:XmlNode;text:string;ranges:Map<XmlNode,Range>;segments:Segment[];paragraphs:Map<XmlNode,Range>;changes:WordReviewChange[];changeNodes:Map<string,XmlNode>;moveGroups:Map<string,string[]>;anchors:Map<string,Range>}
const kinds:Record<string,WordReviewChange['kind']>={ins:'insertion',del:'deletion',moveFrom:'moveFrom',moveTo:'moveTo'}
const propertyChange=(node:XmlNode)=>isWord(node)&&/^(?:rPr|pPr|tblPr|tblGrid|trPr|tcPr|sectPr)Change$/.test(local(node.name))
const hiddenRevision=(node:XmlNode)=>isWord(node,'del')||isWord(node,'moveFrom')
const ancestor=(node:XmlNode,test:(node:XmlNode)=>boolean):XmlNode|undefined=>{for(let at=node.parent;at;at=at.parent)if(test(at))return at;return undefined}
const revisionText=(node:XmlNode):string=>{
 if(isWord(node,'t')||isWord(node,'delText'))return xmlText(node)
 if(isWord(node,'tab'))return '\t'
 if(isWord(node,'br')||isWord(node,'cr'))return '\n'
 if(isWord(node,'noBreakHyphen'))return '\u2011'
 if(isWord(node,'softHyphen'))return '\u00ad'
 if(propertyChange(node)||isWord(node,'instrText')||isWord(node,'delInstrText'))return ''
 return node.children.map(revisionText).join('')
}
function unsupportedRevisions(tree:XmlNode):void {
 for(const node of walk(tree))if(isWord(node)){
  const name=local(node.name)
  if(['cellIns','cellDel','cellMerge','numberingChange','tblPrExChange'].includes(name)||/^(?:customXml|conflict).*(?:RangeStart|RangeEnd|Ins|Del)$/.test(name))fail('DOCX_UNSUPPORTED',`The Word revision ${name} cannot be reviewed without losing its structure.`)
  if(kinds[name]&&ancestor(node,n=>isWord(n,'rPr')||isWord(n,'pPr')||isWord(n,'trPr')))fail('DOCX_UNSUPPORTED','Paragraph-mark and table-row revisions need resolution in Word before review.')
  if(/Change$/.test(name)&&!propertyChange(node))fail('DOCX_UNSUPPORTED',`The Word revision ${name} is not supported.`)
 }
}
function reviewModel(parts:WordPart[]):ReviewModel {
 assertSafeWordParts(parts)
 const tree=partXml(parts,'word/document.xml');unsupportedRevisions(tree)
 const ranges=new Map<XmlNode,Range>(),segments:Segment[]=[],paragraphs=new Map<XmlNode,Range>(),anchors=new Map<string,Range>()
 const changeNodes=new Map<string,XmlNode>(),changes:WordReviewChange[]=[],moveGroups=new Map<string,string[]>(),activeMoves=new Map<string,{id:string;name:string}>()
 let text='',paragraphCount=0
 const visit=(node:XmlNode,hidden=false,paragraph?:XmlNode,run?:XmlNode):void=>{
  // Property snapshots contain obsolete values, never rendered document text.
  if(propertyChange(node)){ranges.set(node,{start:text.length,end:text.length});return}
  if(isWord(node,'txbxContent'))fail('DOCX_UNSUPPORTED','Text-box passages need review in Word before importing.')
  const name=isWord(node)?local(node.name):''
  if(name==='p'){
   if(paragraph)fail('DOCX_UNSUPPORTED','Nested Word paragraphs are not supported.')
   if(paragraphCount++)text+='\n';paragraph=node
  }
  if(name==='r')run=node
  const start=text.length,isHidden=hidden||hiddenRevision(node)
  const id=wordAttr(node,'id')
  if(/^move(?:From|To)RangeStart$/.test(name)){
   if(id===undefined)fail('DOCX_REVIEW','A move range has no identifier.')
   activeMoves.set(name.startsWith('moveFrom')?'moveFrom':'moveTo',{id:id!,name:wordAttr(node,'name')??id!})
  }
  if(name==='commentRangeStart'&&id!==undefined){if(anchors.has(id))fail('DOCX_REVIEW','A comment has duplicate range starts.');anchors.set(id,{start,end:start})}
  let value:string|undefined
  if(name==='t')value=xmlText(node)
  else if(name==='tab')value='\t'
  else if(name==='br'||name==='cr')value='\n'
  else if(name==='noBreakHyphen')value='\u2011'
  else if(name==='softHyphen')value='\u00ad'
  if(value!==undefined){if(!isHidden&&paragraph){text+=value;segments.push({node,run,paragraph,value,start,end:text.length})}}
  else if(!['instrText','delInstrText','delText','rPr','pPr','tblPr','trPr','tcPr','sectPr'].includes(name))for(const child of node.children)visit(child,isHidden,paragraph,run)
  ranges.set(node,{start,end:text.length})
  if(name==='p')paragraphs.set(node,{start,end:text.length})
  if((name==='commentRangeEnd'||name==='commentReference')&&id!==undefined){const existing=anchors.get(id);if(name==='commentRangeEnd'&&existing)existing.end=text.length;else if(!existing)anchors.set(id,{start:text.length,end:text.length})}
  if((name==='moveFrom'||name==='moveTo')&&id!==undefined){const group=activeMoves.get(name);if(group){const key=group.name;moveGroups.set(key,[...(moveGroups.get(key)??[]),id])}}
  if(/^move(?:From|To)RangeEnd$/.test(name))activeMoves.delete(name.startsWith('moveFrom')?'moveFrom':'moveTo')
 }
 visit(tree)
 for(const node of walk(tree))if(isWord(node)&&(kinds[local(node.name)]||propertyChange(node))){
  const id=wordAttr(node,'id');if(id===undefined||changeNodes.has(id))fail('DOCX_REVIEW','Tracked changes need distinct identifiers.')
  changeNodes.set(id!,node)
  const kind=propertyChange(node)?'formatting':kinds[local(node.name)]
  let range=ranges.get(node)??{start:0,end:0}
  if(kind==='formatting'){
   const owner=node.parent?.parent
   if(!owner||!ranges.has(owner))fail('DOCX_UNSUPPORTED','A formatting revision has no readable document anchor.')
   range=ranges.get(owner)!
  }
  const value=revisionText(node)
  changes.push({id:id!,kind,author:wordAttr(node,'author')??'',date:wordAttr(node,'date')??null,...range,before:kind==='deletion'||kind==='moveFrom'?value:kind==='formatting'?serializeXml(elements(node)[0]??node):'',after:kind==='insertion'||kind==='moveTo'?value:kind==='formatting'?serializeXml(node.parent!):''})
 }
 if(!paragraphCount||text.length>200000)fail('DOCX_UNSUPPORTED','Word review needs a readable main body of at most 200,000 characters.')
 // Story revisions have no honest position in the main-body browser rendition.
 for(const part of parts)if(/^word\/(?:header|footer|footnotes|endnotes).*\.xml$/.test(part.name))if(walk(partXml(parts,part.name)).some(n=>isWord(n)&&(kinds[local(n.name)]||propertyChange(n))))fail('DOCX_UNSUPPORTED','Resolve revisions in headers, footers and notes in Word before review.')
 return {tree,text,ranges,segments,paragraphs,changes,changeNodes,moveGroups,anchors}
}
function commentsPartName(parts:WordPart[]):string|undefined {
 const rel=parts.find(p=>p.name==='word/_rels/document.xml.rels')
 if(rel)for(const node of elements(rootXml(partXml(parts,rel.name))))if(/\/comments$/.test(attr(node,'Type')??''))return relationshipTarget(rel.name,attr(node,'Target')??'')
 return parts.some(p=>p.name==='word/comments.xml')?'word/comments.xml':undefined
}
export function inspectWordReview(parts:WordPart[]):{text:string;changes:WordReviewChange[];comments:WordReviewComment[]} {
 const model=reviewModel(parts),name=commentsPartName(parts),comments:WordReviewComment[]=[]
 if(name){
  const tree=partXml(parts,name),paraToComment=new Map<string,string>(),parents=new Map<string,string>()
  const nodes=elements(rootXml(tree)).filter(n=>isWord(n,'comment'))
  for(const node of nodes){const id=wordAttr(node,'id');if(id===undefined||comments.some(c=>c.id===id))fail('DOCX_REVIEW','Word comments need distinct identifiers.');const range=model.anchors.get(id!)
   if(!range)fail('DOCX_REVIEW','A Word comment has no main-document anchor.')
   const paragraphs=walk(node).filter(n=>isWord(n,'p')),body=paragraphs.map(revisionText).join('\n')
   for(const p of paragraphs){const paraId=attr(p,'paraId');if(paraId)paraToComment.set(paraId,id!)}
   const reply=/^\[Reply to comment (\d+)\]\n?/.exec(body)
   comments.push({id:id!,author:wordAttr(node,'author')??'',date:wordAttr(node,'date')??null,body:reply?body.slice(reply[0].length):body,...range,quote:model.text.slice(range.start,range.end),parentId:reply?.[1]??null})
  }
  for(const part of parts)if(/commentsExtended\.xml$/.test(part.name))for(const node of walk(partXml(parts,part.name))){const child=attr(node,'paraId'),parent=attr(node,'paraIdParent');if(child&&parent)parents.set(child,parent)}
  for(const [child,parent] of parents){const id=paraToComment.get(child),parentId=paraToComment.get(parent);if(id&&parentId)comments.find(c=>c.id===id)!.parentId=parentId}
 }
 return {text:model.text,changes:model.changes,comments}
}

export function resolveWordReview(parts:WordPart[],decisions:Record<string,'accept'|'reject'>):WordPart[] {
 const model=reviewModel(parts),resolved=new Map<string,'accept'|'reject'>()
 for(const [id,decision] of Object.entries(decisions)){
  if(!model.changeNodes.has(id)||!['accept','reject'].includes(decision))fail('WORD_CHANGE','Choose an existing Word change and Accept or Reject.')
  resolved.set(id,decision)
 }
 for(const [id,node] of model.changeNodes)if(isWord(node,'moveFrom')||isWord(node,'moveTo')){
  const group=[...model.moveGroups.values()].find(ids=>ids.includes(id))
  if(!group||!group.some(other=>isWord(model.changeNodes.get(other)!,'moveFrom'))||!group.some(other=>isWord(model.changeNodes.get(other)!,'moveTo')))fail('DOCX_UNSUPPORTED','A tracked move is missing its paired range.')
  const choices=group.map(key=>resolved.get(key)).filter(Boolean)
  if(new Set(choices).size>1)fail('WORD_CHANGE','The source and destination of a tracked move must have the same decision.')
  if(choices.length)for(const key of group)resolved.set(key,choices[0]!)
 }
 // Reject decisions which would discard a separately undecided nested revision.
 for(const [id,node] of model.changeNodes){const choice=resolved.get(id);if(!choice)continue
  const removes=(isWord(node,'ins')||isWord(node,'moveTo'))&&choice==='reject'||(isWord(node,'del')||isWord(node,'moveFrom'))&&choice==='accept'
  if(removes&&walk(node).slice(1).some(n=>wordAttr(n,'id')!==undefined&&model.changeNodes.get(wordAttr(n,'id')!)===n&&!resolved.has(wordAttr(n,'id')!)))fail('WORD_CHANGE','Resolve the changes nested inside this passage together.')
 }
 const nodes=walk(model.tree).reverse()
 for(const node of nodes){const id=wordAttr(node,'id'),decision=id===undefined?undefined:resolved.get(id);if(!decision||model.changeNodes.get(id!)!==node)continue
  if(propertyChange(node)){
   const parent=node.parent!,snapshots=elements(node)
   if(snapshots.length!==1||local(snapshots[0].name)!==local(parent.name))fail('DOCX_UNSUPPORTED','A formatting revision has no complete prior-property snapshot.')
   if(decision==='reject'){
    const snapshot=cloneXml(snapshots[0]);replaceXml(parent,[snapshot])
   }else replaceXml(node,[])
  }else {
   const keep=(isWord(node,'ins')||isWord(node,'moveTo'))?decision==='accept':decision==='reject'
   if(keep){
    for(const child of walk(node))if(isWord(child,'delText')||isWord(child,'delInstrText')){const prefix=child.name.includes(':')?child.name.split(':')[0]+':':'';child.name=prefix+(isWord(child,'delText')?'t':'instrText');child.close=child.close?`</${child.name}>`:'';setAttrs(child,child.attrs)}
    replaceXml(node,node.children)
   }else replaceXml(node,[])
  }
 }
 // Range markers carry move bookkeeping, not the moved text itself.
 for(const node of walk(model.tree))if(isWord(node)&&/^move(?:From|To)Range(?:Start|End)$/.test(local(node.name))){
  const from=local(node.name).startsWith('moveFrom'),key=wordAttr(node,'id'),groupName=wordAttr(node,'name')
  const group=groupName?model.moveGroups.get(groupName):undefined
  if(group?.some(id=>resolved.has(id))||key&&nodes.some(n=>isWord(n,from?'moveFromRangeStart':'moveToRangeStart')&&wordAttr(n,'id')===key&&model.moveGroups.get(wordAttr(n,'name')??key)?.some(id=>resolved.has(id))))replaceXml(node,[])
 }
 return withXml(parts,'word/document.xml',model.tree)
}

function validPlain(value:string,limit:number):void {if(typeof value!=='string'||value.length>limit||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(value))fail('WORD_TEXT','Word text contains an invalid character or exceeds the supported limit.')}
function validateRange(model:ReviewModel,start:number,end:number):void {
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>model.text.length)fail('WORD_SELECTION','Select an exact current Word passage.')
 for(const offset of [start,end])if(offset>0&&offset<model.text.length&&/[\ud800-\udbff]/.test(model.text[offset-1])&&/[\udc00-\udfff]/.test(model.text[offset]))fail('WORD_SELECTION','A selection cannot split a Unicode character.')
}
function runForText(value:string,properties?:XmlNode,deleted=false):XmlNode {
 const children:XmlNode[]=properties?[cloneXml(properties)]:[]
 for(const piece of value.split(/(\t|\n)/))if(piece)children.push(piece==='\t'?makeXml('w:tab'):piece==='\n'?makeXml('w:br'):makeXml(deleted?'w:delText':'w:t',{'xml:space':'preserve'},[textXml(piece)]))
 return makeXml('w:r',{},children)
}
function setTextNode(node:XmlNode,value:string):void {node.children=[textXml(value)];node.children[0].parent=node;setAttrs(node,{...node.attrs,'xml:space':'preserve'})}
// Split only at a real displayed-text boundary. Formatting and all nontext
// children are copied into their original side; images never become text.
function splitRun(model:ReviewModel,run:XmlNode,offset:number):void {
 const range=model.ranges.get(run);if(!range||offset<=range.start||offset>=range.end)return
 const before:XmlNode[]=[],after:XmlNode[]=[],properties=elements(run).find(n=>isWord(n,'rPr'))
 for(const child of run.children){if(child===properties)continue
  const at=model.ranges.get(child)
  if(!at||at.end<=offset){before.push(cloneXml(child));continue}
  if(at.start>=offset){after.push(cloneXml(child));continue}
  if(!isWord(child,'t'))fail('WORD_SELECTION','Select a text boundary outside complex run content.')
  const value=xmlText(child),left=cloneXml(child),right=cloneXml(child);setTextNode(left,value.slice(0,offset-at.start));setTextNode(right,value.slice(offset-at.start));before.push(left);after.push(right)
 }
 const make=(children:XmlNode[])=>makeXml(run.name,{...run.attrs},[...(properties?[cloneXml(properties)]:[]),...children])
 replaceXml(run,[make(before),make(after)])
}
function nextRevisionId(tree:XmlNode):number {let next=0;for(const node of walk(tree)){const id=wordAttr(node,'id');if(id&&/^\d+$/.test(id))next=Math.max(next,Number(id)+1)}if(!Number.isSafeInteger(next)||next>2147483645)fail('DOCX_REVIEW','The Word revision identifier space is exhausted.');return next}
export function appendWordEdit(parts:WordPart[],edit:{start:number;end:number;replacement:string;author:string;date:string}):WordPart[] {
 validPlain(edit.replacement,20000);validPlain(edit.author,200);if(!edit.author.trim()||!/^\d{4}-\d\d-\d\dT/.test(edit.date)||!Number.isFinite(Date.parse(edit.date)))fail('WORD_TEXT','A Word edit needs an author and an ISO date.')
 let model=reviewModel(parts);validateRange(model,edit.start,edit.end)
 const paragraph=[...model.paragraphs].find(([,range])=>edit.start>=range.start&&edit.end<=range.end)?.[0]
 if(!paragraph)fail('WORD_SELECTION','A Word edit must stay within one paragraph.')
 if(edit.start===edit.end&&!edit.replacement)fail('WORD_SELECTION','A Word edit must change the selected text.')
 if(model.changes.some(c=>c.kind!=='formatting'&&(c.start<edit.end&&c.end>edit.start||c.start===c.end&&c.start>=edit.start&&c.start<=edit.end)))fail('WORD_SELECTION','Resolve the tracked changes in this passage before adding an edit.')
 const target=model.segments.filter(s=>s.paragraph===paragraph&&s.end>edit.start&&s.start<edit.end)
 const plainRun=(run:XmlNode)=>elements(run).every(n=>isWord(n)&&['rPr','t','tab','br','cr','noBreakHyphen','softHyphen'].includes(local(n.name)))
 if(target.some(s=>!s.run||s.run.parent!==paragraph||!plainRun(s.run))||target.reduce((n,s)=>n+Math.min(s.end,edit.end)-Math.max(s.start,edit.start),0)!==edit.end-edit.start)fail('WORD_SELECTION','Select ordinary paragraph runs outside fields and hyperlinks.')
 if(walk(paragraph!).some(n=>(isWord(n,'fldChar')||isWord(n,'instrText'))&&(model.ranges.get(n)?.start??-1)>=edit.start&&(model.ranges.get(n)?.start??Infinity)<=edit.end))fail('WORD_SELECTION','Select text outside Word fields.')
 ensureWordPrefix(model.tree)
 // Refresh offsets after each split; cloned run nodes intentionally have new identity.
 for(const offset of [edit.end,edit.start]){
  const run=[...model.ranges].find(([n,r])=>isWord(n,'r')&&r.start<offset&&r.end>offset)?.[0]
  if(run){splitRun(model,run,offset);model=reviewModel(withXml(parts,'word/document.xml',model.tree))}
 }
 const p=[...model.paragraphs].find(([,range])=>edit.start>=range.start&&edit.end<=range.end)![0]
 const selected=elements(p).filter(n=>isWord(n,'r')&&(model.ranges.get(n)?.start??-1)>=edit.start&&(model.ranges.get(n)?.end??Infinity)<=edit.end&&(model.ranges.get(n)?.end??0)>(model.ranges.get(n)?.start??0))
 const positionNode=selected[0]??elements(p).find(n=>isWord(n,'r')&&(model.ranges.get(n)?.start??-1)>=edit.start)
 if(!selected.length&&positionNode&&(model.ranges.get(positionNode)?.start??-1)!==edit.start)fail('WORD_SELECTION','Choose an ordinary paragraph text boundary.')
 if(positionNode&&positionNode.parent!==p)fail('WORD_SELECTION','Choose an ordinary paragraph text boundary.')
 const properties=(selected[0]??model.segments.find(s=>s.paragraph===p&&s.start<=edit.start&&s.end>=edit.start)?.run)?.children.find(n=>isWord(n,'rPr'))
 let id=nextRevisionId(model.tree)
 const additions:XmlNode[]=[]
 if(selected.length){
  const deleted=selected.map(cloneXml)
  for(const run of deleted)for(const node of walk(run))if(isWord(node,'t')){node.name='w:delText';node.close='</w:delText>';setAttrs(node,node.attrs)}
  additions.push(makeXml('w:del',{'w:id':String(id++),'w:author':edit.author,'w:date':edit.date},deleted))
 }
 if(edit.replacement)additions.push(makeXml('w:ins',{'w:id':String(id++),'w:author':edit.author,'w:date':edit.date},[runForText(edit.replacement,properties)]))
 const index=positionNode?p.children.indexOf(positionNode):p.children.length
 for(const node of additions)node.parent=p;p.children.splice(index,0,...additions)
 for(const node of selected)replaceXml(node,[])
 const output=withXml(parts,'word/document.xml',model.tree),actual=reviewModel(output).text
 if(actual!==model.text.slice(0,edit.start)+edit.replacement+model.text.slice(edit.end))fail('WORD_SELECTION','This Word selection cannot be edited without changing surrounding content.')
 return output
}

function commentMetadataPart(name:string):boolean{return /^word\/comments(?:Extended|Extensible|Ids|UserData)\.xml$/i.test(name)||/^word\/people\.xml$/i.test(name)}
function removeParts(parts:WordPart[],removed:Set<string>):WordPart[] {
 let output=parts.filter(p=>!removed.has(p.name))
 for(const part of output)if(/\.rels$/.test(part.name)){
  const tree=partXml(output,part.name);let changed=false
  for(const node of elements(rootXml(tree))){const target=attr(node,'Target');if(target&&removed.has(relationshipTarget(part.name,target))){replaceXml(node,[]);changed=true}}
  if(changed)output=withXml(output,part.name,tree)
 }
 const types=partXml(output,'[Content_Types].xml');let changed=false
 for(const node of elements(rootXml(types)))if(removed.has((attr(node,'PartName')??'').replace(/^\//,''))){replaceXml(node,[]);changed=true}
 if(changed)output=withXml(output,'[Content_Types].xml',types)
 return output
}
function commentsRelationship(parts:WordPart[],enabled:boolean):WordPart[] {
 const name='word/_rels/document.xml.rels'
 const tree=parts.some(p=>p.name===name)?partXml(parts,name):makeXml('',{},[makeXml('Relationships',{xmlns:REL_NS})])
 const root=rootXml(tree)
 for(const node of [...elements(root)])if(/\/comments(?:Extended|Extensible|Ids|UserData)?$|\/people$/.test(attr(node,'Type')??''))replaceXml(node,[])
 if(enabled){const ids=new Set(elements(root).map(n=>attr(n,'Id')));let n=1;while(ids.has(`rIdLocketComments${n}`))n++;appendXml(root,makeXml('Relationship',{Id:`rIdLocketComments${n}`,Type:`${WORD_NS.replace('/wordprocessingml/2006/main','/officeDocument/2006/relationships')}/comments`,Target:'comments.xml'}))}
 return withXml(parts,name,tree)
}
function insertAnchor(model:ReviewModel,offset:number,node:XmlNode):void {
 const paragraph=[...model.paragraphs].find(([,r])=>offset>=r.start&&offset<=r.end)?.[0]
 if(!paragraph)fail('WORD_SELECTION','A Word comment needs a real paragraph anchor.')
 let candidate:XmlNode|undefined
 for(const segment of model.segments)if(segment.paragraph===paragraph&&segment.start>=offset){candidate=segment.run??segment.node;break}
 // Range markers may be placed beside runs inside a hyperlink or revision;
 // this preserves the precise anchor without duplicating the surrounding tag.
 const container=candidate?.parent??paragraph!
 if(candidate&&(model.ranges.get(candidate)?.start??-1)!==offset)fail('WORD_SELECTION','The comment anchor is not a displayed text boundary.')
 const index=candidate?container.children.indexOf(candidate):container.children.length
 node.parent=container;container.children.splice(index,0,node)
}
export function writeWordComments(parts:WordPart[],comments:Omit<WordReviewComment,'quote'>[]):WordPart[] {
 let model=reviewModel(parts)
 if(comments.length>500||new Set(comments.map(c=>c.id)).size!==comments.length)fail('WORD_COMMENT','Use at most 500 distinct Word comments.')
 for(const comment of comments){
  if(!/^\d+$/.test(comment.id)||Number(comment.id)>2147483647)fail('WORD_COMMENT','Word comment identifiers must be nonnegative 32-bit decimal integers.')
  validPlain(comment.author,200);validPlain(comment.body,20000);validateRange(model,comment.start,comment.end)
  if(comment.date!==null&&(!/^\d{4}-\d\d-\d\dT/.test(comment.date)||!Number.isFinite(Date.parse(comment.date))))fail('WORD_COMMENT','A Word comment date must be an ISO timestamp.')
  if(comment.parentId&&(comment.parentId===comment.id||!comments.some(c=>c.id===comment.parentId)))fail('WORD_COMMENT','A reply must name another exported Word comment.')
  const seen=new Set<string>([comment.id]);let parent=comment.parentId
  while(parent){if(seen.has(parent))fail('WORD_COMMENT','Word comment replies cannot form a cycle.');seen.add(parent);parent=comments.find(c=>c.id===parent)?.parentId}
 }
 // Remove every original anchor, including references in non-main stories.
 let output=parts
 for(const part of parts)if(/^word\/.*\.xml$/.test(part.name)&&!/^word\/comments/.test(part.name)){
  const tree=part.name==='word/document.xml'?model.tree:partXml(parts,part.name);let changed=false
  for(const node of walk(tree))if(isWord(node)&&['commentRangeStart','commentRangeEnd','commentReference','annotationRef'].includes(local(node.name))){replaceXml(node,[]);changed=true}
  if(changed||part.name==='word/document.xml')output=withXml(output,part.name,tree)
 }
 const oldName=commentsPartName(parts),removed=new Set(parts.filter(p=>commentMetadataPart(p.name)||p.name===oldName||p.name==='word/_rels/comments.xml.rels').map(p=>p.name))
 output=removeParts(output,removed)
 model=reviewModel(output);ensureWordPrefix(model.tree)
 // Split boundary runs from the end so every new marker has a real XML location.
 for(const offset of [...new Set(comments.flatMap(c=>[c.start,c.end]))].sort((a,b)=>b-a)){
  const run=[...model.ranges].find(([n,r])=>isWord(n,'r')&&r.start<offset&&r.end>offset)?.[0]
  if(run){splitRun(model,run,offset);output=withXml(output,'word/document.xml',model.tree);model=reviewModel(output)}
 }
 for(const comment of comments){
  insertAnchor(model,comment.start,makeXml('w:commentRangeStart',{'w:id':comment.id}))
  insertAnchor(model,comment.end,makeXml('w:commentRangeEnd',{'w:id':comment.id}))
  insertAnchor(model,comment.end,makeXml('w:r',{},[makeXml('w:commentReference',{'w:id':comment.id})]))
 }
 output=withXml(output,'word/document.xml',model.tree)
 output=commentsRelationship(output,comments.length>0)
 if(comments.length){
  const nodes=comments.map(comment=>{
   const body=(comment.parentId?`[Reply to comment ${comment.parentId}]\n`:'')+comment.body
   return makeXml('w:comment',{'w:id':comment.id,'w:author':comment.author,...(comment.date?{'w:date':comment.date}:{})},body.split('\n').map(line=>makeXml('w:p',{},[runForText(line)])))
  })
  output=withXml(output,'word/comments.xml',makeXml('',{},[makeXml('w:comments',{'xmlns:w':WORD_NS},nodes)]))
  const types=partXml(output,'[Content_Types].xml'),root=rootXml(types)
  appendXml(root,makeXml('Override',{PartName:'/word/comments.xml',ContentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'}));output=withXml(output,'[Content_Types].xml',types)
 }
 return output
}

export function stripWordMetadata(parts:WordPart[],keepRevisionAuthors=false):WordPart[] {
 assertSafeWordParts(parts)
 const removed=new Set(parts.filter(p=>/^docProps\//.test(p.name)||/^customXml\//.test(p.name)||commentMetadataPart(p.name)||/^word\/(?:printerSettings|glossary)\//.test(p.name)).map(p=>p.name))
 let output=removeParts(parts,removed)
 for(const part of output)if(/^word\/.*\.xml$/.test(part.name)){
  const tree=partXml(output,part.name);let changed=false
  for(const node of walk(tree)){
   if(isWord(node)&&['rsids','docVars','mailMerge','docId','recipientData','dataBinding'].includes(local(node.name))){replaceXml(node,[]);changed=true;continue}
   if(isWord(node,'customXml')||isWord(node,'smartTag')){replaceXml(node,node.children);changed=true;continue}
   // Hidden runs are private content, including field instructions. A deleted
   // tracked run is retained until a person decides its revision explicitly.
   if(isWord(node,'r')&&elements(node).some(n=>isWord(n,'rPr')&&elements(n).some(p=>isWord(p,'vanish')||isWord(p,'webHidden')))){
    const hidden=elements(node).find(n=>isWord(n,'rPr'))!.children.some(p=>(isWord(p,'vanish')||isWord(p,'webHidden'))&&!['0','false','off'].includes(wordAttr(p,'val')??'1'))
    if(hidden){replaceXml(node,[]);changed=true;continue}
   }
   if(!node.name)continue
   const attrs={...node.attrs};let attrChanged=false
   const keepAuthor=keepRevisionAuthors&&isWord(node)&&(!!kinds[local(node.name)]||propertyChange(node))
   for(const key of Object.keys(attrs))if(!key.startsWith('xmlns')&&(/^(?:rsid\w*|paraId|textId|durableId|initials|userId|providerId|editId)$/.test(local(key))||!keepAuthor&&['author','date'].includes(local(key))&&namespace(node,key)===WORD_NS)){
    delete attrs[key];attrChanged=true
   }
   // Required revision/comment authors stay present but carry no private name.
   if(!keepAuthor&&isWord(node)&&(kinds[local(node.name)]||propertyChange(node)||isWord(node,'comment'))){ensureWordPrefix(tree);attrs['w:author']='Reviewer';attrChanged=true}
   if(attrChanged){setAttrs(node,attrs);changed=true}
  }
  if(changed)output=withXml(output,part.name,tree)
 }
 return output
}
