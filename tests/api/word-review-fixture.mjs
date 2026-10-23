import { zip, file } from './files.mjs'
import { wordTemplateFixture } from './word-template-fixture.mjs'
export function wordReviewFixture(){
 const source=wordTemplateFixture({title:'SUPPLIER SERVICES AGREEMENT'}),parts=source.parts.map(([name,value])=>[name,value])
 const who=id=>`w:id="${id}" w:author="${Number(id)%2?'Alicia Counsel':'Morgan Supplier'}" w:date="2026-10-16T12:00:00Z"`
 const run=text=>`<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`
 const ins=(id,text)=>`<w:ins ${who(id)}>${run(text)}</w:ins>`
 const del=(id,text)=>`<w:del ${who(id)}><w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`
 const paragraph=(body,comment)=>`<w:p><w:pPr><w:pStyle w:val="Agreement"/></w:pPr>${comment===undefined?'':`<w:commentRangeStart w:id="${comment}"/>`}${body}${comment===undefined?'':`<w:commentRangeEnd w:id="${comment}"/><w:r><w:commentReference w:id="${comment}"/></w:r>`}</w:p>`
 const body=[
  paragraph(run('1. Payment: ')+ins(0,'30 days ')+del(4,'60 days ')+run('after invoice.'),0),
  paragraph(run('Invoice review remains with the accounts payable team.')),
  paragraph(run('Supporting records accompany each invoice.')),
  paragraph(run('2. Liability: ')+ins(1,'$2,000,000 ')+del(5,'$1,000,000 ')+run('aggregate coverage.'),1),
  paragraph(run('3. Security: ')+ins(2,'annual SOC 2 ')+del(6,'self-certification ')+run('is required.'),2),
  paragraph(run('4. Notices: ')+ins(3,'email ')+del(7,'courier ')+run('to the registered office.'),3),
  paragraph(run('5. Moved obligation: ')+`<w:moveFromRangeStart w:id="20" w:name="move-a"/><w:moveFrom ${who(8)}><w:r><w:delText>Maintain insurance.</w:delText></w:r></w:moveFrom><w:moveFromRangeEnd w:id="20"/>`),
  paragraph(run('6. Insurance: ')+`<w:moveToRangeStart w:id="21" w:name="move-a"/><w:moveTo ${who(9)}>${run('Maintain insurance.')}</w:moveTo><w:moveToRangeEnd w:id="21"/>`),
  `<w:p><w:pPr><w:pStyle w:val="Agreement"/></w:pPr><w:r><w:rPr><w:b/><w:rPrChange ${who(10)}><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr><w:t>7. Confidentiality survives.</w:t></w:r></w:p>`,
  `<w:p><w:pPr><w:jc w:val="center"/><w:pPrChange ${who(11)}><w:pPr><w:jc w:val="left"/></w:pPr></w:pPrChange></w:pPr>${run('8. Governing law: New York.')}</w:p>`,
 ].join('')
 const document=parts.find(([name])=>name==='word/document.xml')
 document[1]=document[1].replace(/(<w:body>)[\s\S]*?(<w:tbl>)/,(_,open,table)=>open+body+table)
 const commentBodies=['Please confirm the payment period.','Please confirm the liability cap.','Security report to be delivered annually.','This private negotiating position must stay internal.']
 parts.push(['word/comments.xml',`<?xml version="1.0"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${commentBodies.map((text,id)=>`<w:comment ${who(id)}><w:p>${run(text)}</w:p></w:comment>`).join('')}</w:comments>`],['docProps/core.xml','<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>synthetic-locket-private-author</dc:creator><cp:lastModifiedBy>synthetic-locket-private-editor</cp:lastModifiedBy></cp:coreProperties>'])
 parts.find(([name])=>name==='[Content_Types].xml')[1]=parts.find(([name])=>name==='[Content_Types].xml')[1].replace('</Types>','<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>')
 parts.find(([name])=>name==='word/_rels/document.xml.rels')[1]=parts.find(([name])=>name==='word/_rels/document.xml.rels')[1].replace('</Relationships>','<Relationship Id="comments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>')
 parts.find(([name])=>name==='_rels/.rels')[1]=parts.find(([name])=>name==='_rels/.rels')[1].replace('</Relationships>','<Relationship Id="properties" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>')
 return {bytes:zip(parts),parts,commentBodies,decisions:Object.fromEntries(Array.from({length:12},(_,id)=>[String(id),[3,7,10].includes(id)?'reject':'accept']))}
}
export async function uploadedWordReview(h){
 const initial=await h.owner.command('request.create',{title:'Supplier services renewal markup',type:'nda',party:{name:'Ridgeway Services',kind:'supplier',contacts:[{name:'Morgan Supplier',email:'synthetic-locket-26@example.test'}]},file:file('base.docx',wordTemplateFixture().source)})
 let a=(await h.owner.state()).agreements.find(row=>row.id===initial.id)
 const fixture=wordReviewFixture(),uploaded=await h.owner.command('version.upload',{agreementId:a.id,version:a.version,kind:'counterparty',file:file('supplier-markup.docx',fixture.bytes)})
 a=(await h.owner.state()).agreements.find(row=>row.id===a.id)
 return {...fixture,a,initial,uploaded}
}
