import { fail, integer, list, money, object, text } from './model'
import { wordModel, writeWord, type WordMark, type WordPart } from './word-template-document'
const encoder=new TextEncoder(),escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
export interface WordPricing {tableIndex:number;prototypeRow:number;totalRow:number}
const cells=(row:string)=>[...row.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)]
function tables(parts:WordPart[]){return [...wordModel(parts).xml.matchAll(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g)].map(t=>({xml:t[0],start:t.index!,rows:[...t[0].matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)]}))}
export function pricingInventory(parts:WordPart[]) {
 return tables(parts).map((table,index)=>({index,rows:table.rows.map((row,i)=>({index:i,text:wordModel([{name:'word/document.xml',bytes:encoder.encode(row[0])}]).text,columns:cells(row[0]).length}))}))
}
export function validatePricing(parts:WordPart[],pricing:WordPricing,marks:WordMark[]){
 const table=tables(parts)[pricing.tableIndex]
 if(!table||table.xml.match(/<w:tbl(?=\s|>)/g)?.length!==1||!table.rows[pricing.prototypeRow]||!table.rows[pricing.totalRow]||pricing.totalRow<=pricing.prototypeRow||cells(table.rows[pricing.prototypeRow][0]).length<2||cells(table.rows[pricing.totalRow][0]).length<2)fail('PRICING_TABLE','Choose a main-document table, a prototype item row and a later total row, each with at least two cells.')
 const start=table.start+table.rows[pricing.prototypeRow].index!,end=table.start+table.rows[pricing.totalRow].index!+table.rows[pricing.totalRow][0].length,model=wordModel(parts)
 if(marks.some(mark=>model.paragraphs.some(p=>mark.start>=p.start&&mark.end<=p.end&&p.xmlStart>=start&&p.xmlEnd<=end)))fail('PRICING_TABLE','Item and total rows are filled from line items; remove overlapping field/optional markings.')
 return table
}
const amount=(cents:number)=>`${Math.floor(cents/100)}.${String(cents%100).padStart(2,'0')}`
function cellText(cell:string,value:string){
 let first=true,found=false
 let out=cell.replace(/(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g,(_,open:string,_body:string,close:string)=>{found=true;const replacement=first?escape(value):'';first=false;return open+replacement+close})
 if(!found)out=out.replace('</w:p>',`<w:r><w:t xml:space="preserve">${escape(value)}</w:t></w:r></w:p>`)
 return out
}
function rowCells(row:string,values:Map<number,string>){let index=0;return row.replace(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g,cell=>{const value=values.get(index++);return value===undefined?cell:cellText(cell,value)})}
export function renderPricing(parts:WordPart[],pricing:WordPricing,input:unknown) {
 const table=validatePricing(parts,pricing,[]),lineItems=list({items:input},'items',100).map(value=>{
  const row=object(value),quantity=integer({quantity:Number(row.quantity)},'quantity',1,1000000),unitCents=money(row,'unitPrice')
  if(unitCents===null)fail('PRICING','Every line item needs a USD unit price.')
  const totalCents=unitCents*quantity
  if(!Number.isSafeInteger(totalCents))fail('PRICING','A line total exceeds the supported USD range.')
  return {description:text(row,'description',500),quantity,unitCents,totalCents}
 })
 if(!lineItems.length)fail('PRICING','Add at least one line item for the repeating pricing table.')
 const totalCents=lineItems.reduce((n,item)=>n+item.totalCents,0)
 if(!Number.isSafeInteger(totalCents))fail('PRICING','The USD total exceeds the supported exact range.')
 const prototype=table.rows[pricing.prototypeRow],total=table.rows[pricing.totalRow],lastCell=cells(prototype[0]).length-1,totalCell=cells(total[0]).length-1
 const rows=lineItems.map(item=>rowCells(prototype[0],new Map([[0,`${item.description} (${item.quantity} x $${amount(item.unitCents)})`],[lastCell,amount(item.totalCents)]]))).join('')
 const totalRow=rowCells(total[0],new Map([[totalCell,amount(totalCents)]]))
 const xml=wordModel(parts).xml,start=table.start+prototype.index!,end=table.start+total.index!+total[0].length
 const output=parts.map(part=>part.name==='word/document.xml'?{...part,bytes:encoder.encode(xml.slice(0,start)+rows+totalRow+xml.slice(end))}:part)
 return {bytes:writeWord(output),text:wordModel(output).text,pricing:{lineItems,totalCents,currency:'USD'}}
}
export function pricingDefinition(p:Record<string,unknown>):WordPricing{return {tableIndex:integer(p,'tableIndex',0,1999),prototypeRow:integer(p,'prototypeRow',0,9999),totalRow:integer(p,'totalRow',1,9999)}}
