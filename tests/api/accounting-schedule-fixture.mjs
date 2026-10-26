import {file,pdf} from './files.mjs'
export const pantryBindings={PANTRY_ORIGIN:'https://pantry.example.test',PANTRY_TOKEN:'synthetic-locket-3'}
export function pantryFake(calls,mode=()=> 'draft'){
 let bill
 return async request=>{
  const url=new URL(request.url)
  if(url.origin!==pantryBindings.PANTRY_ORIGIN)throw new Error('Unexpected accounting destination')
  const body=request.method==='POST'?await request.json():null
  calls.push({method:request.method,url:request.url,body,key:request.headers.get('Idempotency-Key'),authorization:request.headers.get('Authorization')})
  if(mode()==='failure')return Response.json({error:'synthetic-locket-4'},{status:503})
  if(mode()==='unknown')throw new Error('synthetic-locket-5')
  if(body)bill={id:'synthetic-locket-6',vendor_id:body.vendorId,reference:body.reference,bill_date:body.billDate,due_date:body.dueDate,total_cents:125050,status:'draft',lines:[{description:body.lines[0].description,account_id:body.lines[0].accountId,amount_cents:125050}]}
  return Response.json({...bill,status:mode()==='posted'?'posted':'draft',...(mode()==='changed'?{total_cents:1}:{})})
 }
}
export async function scheduleFixture(h,{restricted=false}={}){
 const quote='Pay USD 1,250.50 on November 1, 2026 for implementation. '+crypto.randomUUID()
 const source=await h.owner.command('legacy.import',{title:'synthetic-locket payment schedule',type:'supplier',party:{name:'synthetic-locket vendor',kind:'supplier'},value:'100000',file:file('supplier.pdf',pdf(quote)),text:quote,sourceSystem:'Authorized archive',sourceId:crypto.randomUUID(),signed:true,restricted})
 const obligation=await h.owner.command('obligation.add',{agreementId:source.id,description:'Implementation payment',ownerId:(await h.owner.state()).actor.id,dueDate:'2026-11-01',recurrence:'none',evidence:'note',citation:{quote}})
 const current=async()=>(await h.owner.state()).agreements.find(a=>a.id===source.id)
 const prepare=async(extra={})=>h.owner.command('accounting.schedule.prepare',{agreementId:source.id,version:(await current()).version,obligationId:obligation.id,amount:'1250.50',billDate:'2026-10-26',vendorId:'synthetic-locket-7',accountId:'synthetic-locket-8',citation:{quote},confirmAllocation:true,...extra})
 const confirm=()=>h.owner.command('obligation.update',{agreementId:source.id,obligationId:obligation.id,action:'confirm'})
 const row=async(id)=>(await h.owner.state()).accountingSchedules.find(r=>r.id===id)
 return {source,obligation,quote,current,prepare,confirm,row}
}
