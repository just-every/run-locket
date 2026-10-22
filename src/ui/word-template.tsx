import { blankLine, PricingLines, type PricingLine } from './pricing-lines'
import { useRef, useState } from 'react'
import { fileToPayload, type Row } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { parse, typeLabel } from './format'
import { TemplateFields } from './intake'

export function WordTemplateUpload({locket,onSaved,template}:{locket:Locket;onSaved:(id:string)=>void;template?:Row}) {
 return <details className="lk-disclosure"><summary>{template?'Upload a new Word version':'Author a template from Word'}</summary>
  <Form busy={locket.busy} submit="Upload Word template" onSubmit={async(data,form)=>{
   const file=data.get('file') as File
   const result=await locket.run('template.word.upload',{...(template?{templateId:template.id}:{name:value(data,'name'),type:value(data,'type')}),file:await fileToPayload(file)})
   if(result){onSaved(result.id);form.reset()}
  }}>
   {!template&&<><Field label="Word template name"><input name="name" required/></Field><Field label="Word template type"><select name="type">{Object.entries(typeLabel).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field></>}
   <Field label="Existing Word document"><input type="file" name="file" accept=".docx" required/></Field>
   <p>The original stays unchanged. Mark main-document text and optional paragraphs; styles, numbering, tables, headers and footers stay in the Word package. Remove active content, external relationships and tracked changes before uploading.</p>
  </Form>
 </details>
}
export function WordTemplateEditor({word,version,locket,editor}:{word:Row;version:Row;locket:Locket;editor:boolean}) {
 const source=useRef<HTMLTextAreaElement>(null),[selection,setSelection]=useState({start:0,end:0}),[name,setName]=useState(''),[label,setLabel]=useState(''),[kind,setKind]=useState('field'),[required,setRequired]=useState(true),[preview,setPreview]=useState('')
 const marks=parse<any[]>(word.marks),draft=version.status==='draft'
 const inventory=parse<any[]>(word.table_inventory),[tableIndex,setTableIndex]=useState(0),[prototypeRow,setPrototypeRow]=useState(1),[totalRow,setTotalRow]=useState((inventory[0]?.rows.length??3)-1),[items,setItems]=useState<PricingLine[]>([blankLine()])
 const table=inventory[tableIndex]
 const select=()=>{if(source.current)setSelection({start:source.current.selectionStart,end:source.current.selectionEnd})}
 return <section aria-label={`Word template v${version.number}`}>
  <p><a href={`/api/locket/files/${word.source_artifact_id}`}>Download original Word template</a></p>
  <Field label="Word source text" hint="Select the exact words for a field, or one entire paragraph for an optional clause."><textarea ref={source} readOnly value={word.source_text} rows={12} onSelect={select} onKeyUp={select} onPointerUp={select}/></Field>
  <ul>{marks.map(m=><li key={m.name}><strong>{m.label}</strong> · {m.kind==='field'?'Field':'Optional clause'} · “{m.quote}”{draft&&editor&&<button className="lk-small" aria-label={`Remove ${m.label}`} disabled={locket.busy} type="button" onClick={()=>void locket.run('template.word.mark',{versionId:version.id,revision:word.revision,marks:marks.filter(other=>other.name!==m.name)})}>Remove</button>}</li>)}</ul>
  {draft&&editor&&<>
   <p>Selected: {word.source_text.slice(selection.start,selection.end)||'Select text above.'}</p>
   <Field label="Mark kind"><select value={kind} onChange={e=>setKind(e.target.value)}><option value="field">Field</option><option value="optional">Optional paragraph</option></select></Field>
   <Field label="Field or clause name"><input value={name} onChange={e=>setName(e.target.value)} pattern="[a-z][a-z0-9_]*"/></Field>
   <Field label="Field or clause label"><input value={label} onChange={e=>setLabel(e.target.value)}/></Field>
   {kind==='field'&&<label><input type="checkbox" checked={required} onChange={e=>setRequired(e.target.checked)}/> Required answer</label>}
   <button type="button" disabled={locket.busy||selection.end<=selection.start||!name||!label} onClick={async()=>{
    const result=await locket.run('template.word.mark',{versionId:version.id,revision:word.revision,marks:[...marks,{...selection,quote:word.source_text.slice(selection.start,selection.end),kind,name,label,required}]})
    if(result){setName('');setLabel('');setPreview('')}
   }}>Mark selection</button>
   {table&&<details><summary>Set repeating USD pricing table</summary><Form busy={locket.busy} submit="Use pricing table" onSubmit={()=>void locket.run('template.word.pricing',{versionId:version.id,revision:word.revision,tableIndex,prototypeRow,totalRow})}><Field label="Pricing table"><select value={tableIndex} onChange={e=>{const index=Number(e.target.value);setTableIndex(index);setPrototypeRow(1);setTotalRow(inventory[index].rows.length-1)}}>{inventory.map(t=><option key={t.index} value={t.index}>Table {t.index+1}</option>)}</select></Field><Field label="Prototype item row"><select value={prototypeRow} onChange={e=>setPrototypeRow(Number(e.target.value))}>{table.rows.map((r:any)=><option key={r.index} value={r.index}>Row {r.index+1}: {r.text.slice(0,80)}</option>)}</select></Field><Field label="Total row"><select value={totalRow} onChange={e=>setTotalRow(Number(e.target.value))}>{table.rows.map((r:any)=><option key={r.index} value={r.index}>Row {r.index+1}: {r.text.slice(0,80)}</option>)}</select></Field><p>The first cell holds the description, quantity and unit price; the last cell holds each calculated USD line total. Body rows from the prototype to the row before the total are replaced by your supplied line items. The total row’s last cell holds the grand total. Preview this selection before approval.</p></Form></details>}
   {word.pricing&&<p>Repeating USD pricing table configured.</p>}
   {marks.some(m=>m.kind==='field')&&<Form busy={locket.busy} submit="Preview Word document" onSubmit={async data=>{
    const fields:Record<string,string>={},clauseChoices:Record<string,string>={}
    for(const[key,answer]of data.entries()){if(key.startsWith('field.'))fields[key.slice(6)]=String(answer);if(key.startsWith('clause.'))clauseChoices[key.slice(7)]=String(answer)}
    const result=await locket.run('template.word.preview',{versionId:version.id,revision:word.revision,fields,clauseChoices,...(word.pricing?{lineItems:items}:{})});if(result)setPreview(result.text)
   }}><h4>Preview with sample answers</h4><TemplateFields template={version}/>{word.pricing&&<PricingLines items={items} onChange={setItems}/>}</Form>}
  </>}
  {word.preview_artifact_id&&word.preview_revision===word.revision&&<p><a href={`/api/locket/files/${word.preview_artifact_id}`}>Download populated Word preview</a></p>}
  {preview&&<pre className="lk-document" aria-label="Word preview text">{preview}</pre>}
 </section>
}
