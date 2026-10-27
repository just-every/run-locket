import {file,pdf} from './files.mjs'
export const pantryBindings={PANTRY_ORIGIN:'https://pantry.example.test',PANTRY_TOKEN:'synthetic-locket-3'}
export function pantryFake(calls,mode=()=> 'draft'){
 const records=new Map()
 return async request=>{
  const url=new URL(request.url)
  if(url.origin!==pantryBindings.PANTRY_ORIGIN)throw new Error('Unexpected accounting destination')
  const body=request.method==='POST'?await request.json():null
  calls.push({method:request.method,url:request.url,body,key:request.headers.get('Idempotency-Key'),authorization:request.headers.get('Authorization')})
  if(mode()==='failure')return Response.json({error:'synthetic-locket-4'},{status:503})
  if(mode()==='unknown')throw new Error('synthetic-locket-5')
  let record
  if(body){const amount=Math.round(Number(body.lines[0].amount??body.lines[0].rate)*100),id='synthetic-locket-'+(records.size+6);record={id,...(body.customerId?{customer_id:body.customerId,number:body.number,issue_date:body.issueDate}:{vendor_id:body.vendorId,reference:body.reference,bill_date:body.billDate}),due_date:body.dueDate,total_cents:amount,status:'draft',lines:[{description:body.lines[0].description,account_id:body.lines[0].accountId,amount_cents:amount,...(body.customerId?{quantity_milli:1000,unit_cents:amount,tax_code:'exempt',tax_cents:0}:{})}]};records.set(id,record)}else record=records.get(decodeURIComponent(url.pathname.split('/').at(-1)))
  return Response.json({...record,status:mode()==='posted'?(record?.customer_id?'issued':'posted'):'draft',...(mode()==='changed'?{total_cents:1}:{})})
 }
}
export async function scheduleFixture(h,{restricted=false,type='supplier',recurrence='none',dueDate='2026-11-01',quoteSuffix='',description='Implementation payment'}={}){
 const quote='Pay USD 1,250.50 on November 1, 2026 for implementation. '+crypto.randomUUID()+' '+quoteSuffix
 const source=await h.owner.command('legacy.import',{title:type==='customer'?'Synthetic customer services agreement':'Synthetic supplier implementation agreement',type,party:{name:'synthetic-locket counterparty',kind:type},value:'100000',file:file(type==='customer'?'customer-agreement.pdf':'supplier-agreement.pdf',pdf(quote)),text:quote,sourceSystem:'Authorized archive',sourceId:crypto.randomUUID(),signed:true,restricted})
 const obligation=await h.owner.command('obligation.add',{agreementId:source.id,description,ownerId:(await h.owner.state()).actor.id,dueDate,recurrence,evidence:'note',citation:{quote}})
 const current=async()=>(await h.owner.state()).agreements.find(a=>a.id===source.id)
 const prepare=async(extra={})=>h.owner.command('accounting.schedule.prepare',{agreementId:source.id,version:(await current()).version,obligationId:obligation.id,amount:'1250.50',billDate:'2026-10-26',...(type==='customer'?{customerId:'synthetic-locket-7',taxCode:'exempt'}:{vendorId:'synthetic-locket-7'}),accountId:'synthetic-locket-8',citation:{quote},confirmAllocation:true,...extra})
 const confirm=()=>h.owner.command('obligation.update',{agreementId:source.id,obligationId:obligation.id,action:'confirm'})
 const row=async(id)=>(await h.owner.state()).accountingSchedules.find(r=>r.id===id)
 return {source,obligation,quote,current,prepare,confirm,row}
}
