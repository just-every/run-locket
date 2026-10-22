import { Field } from './controls'
export type PricingLine={description:string;quantity:string;unitPrice:string}
export const blankLine=():PricingLine=>({description:'',quantity:'1',unitPrice:''})
export function PricingLines({items,onChange}:{items:PricingLine[];onChange:(items:PricingLine[])=>void}) {
 const update=(index:number,key:keyof PricingLine,value:string)=>onChange(items.map((item,i)=>i===index?{...item,[key]:value}:item))
 let total=0n,valid=true
 for(const item of items){if(!/^\d+$/.test(item.quantity)||!/^\d+(?:\.\d{1,2})?$/.test(item.unitPrice)){valid=false;continue}const[whole,fraction='']=item.unitPrice.split('.');total+=(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')))*BigInt(item.quantity)}
 return <fieldset className="lk-fieldset"><legend>Pricing line items (USD)</legend>
  {items.map((item,index)=><div className="lk-stack" key={index}>
   <Field label={`Item ${index+1} description`}><input required value={item.description} onChange={e=>update(index,'description',e.target.value)}/></Field>
   <Field label={`Item ${index+1} quantity`}><input type="number" min="1" max="1000000" step="1" required value={item.quantity} onChange={e=>update(index,'quantity',e.target.value)}/></Field>
   <Field label={`Item ${index+1} unit price (USD)`}><input inputMode="decimal" required pattern={'[0-9]+(\\.[0-9]{1,2})?'} value={item.unitPrice} onChange={e=>update(index,'unitPrice',e.target.value)}/></Field>
   {items.length>1&&<button className="lk-small" type="button" aria-label={`Remove item ${index+1}`} onClick={()=>onChange(items.filter((_,i)=>i!==index))}>Remove item</button>}
  </div>)}
  <button className="lk-small" type="button" disabled={items.length>=100} onClick={()=>onChange([...items,blankLine()])}>Add line item</button>
  <p>Calculated USD total: {valid?`$${total/100n}.${String(total%100n).padStart(2,'0')}`:'Complete the prices and quantities.'}</p>
 </fieldset>
}
