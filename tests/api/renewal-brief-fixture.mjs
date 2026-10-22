import {file,pdf} from './files.mjs'
export const accountingBindings={QUICKBOOKS_ACCESS_TOKEN:'synthetic-locket-1',QUICKBOOKS_REALM_ID:'123',QUICKBOOKS_SANDBOX:'true'}
export function accountingFake(calls,mode=()=> 'ok') {
 return async request=>{
  const url=new URL(request.url),query=url.searchParams.get('query')
  calls.push({url:url.origin+url.pathname,query,authorization:request.headers.get('authorization')})
  if(mode()==='refused')return Response.json({Fault:{}},{status:401})
  const bills=Array.from({length:8},(_,i)=>({Id:String(i+1),VendorRef:{value:'42'},TxnDate:`2026-0${i+1}-01`,CurrencyRef:{value:mode()==='currency'?'EUR':'USD'},TotalAmt:10500,Balance:i<4?0:10500}))
  return Response.json({QueryResponse:{Bill:bills}})
 }
}
export async function renewalBriefFixture(h,{restricted=false}={}) {
 const ownerId=(await h.owner.state()).actor.id
 const maker=await h.invite('synthetic-locket-maker@example.test','approver'),counsel=await h.invite('synthetic-locket-counsel@example.test','counsel')
 const quote='Annual price increases shall not exceed 3 percent.'
 const body=`Supplier services. ${quote} Give 60 days notice. The term is January 1 to December 31, 2026.`
 const source=await h.owner.command('legacy.import',{title:'synthetic-locket supplier',type:'supplier',party:{name:'synthetic-locket supplier',kind:'supplier'},value:'100000',sourceSystem:'Authorized archive',sourceId:crypto.randomUUID(),file:file('supplier.pdf',pdf(body)),text:body,signed:true,restricted})
 for(const [key,value]of [['effective_date','2026-01-01'],['end_date','2026-12-31'],['notice_days','60'],['auto_renew','no']]){
  const t=await h.owner.command('term.propose',{agreementId:source.id,key,value,citation:{quote:'Give 60 days notice.'}})
  await h.owner.command('term.decide',{agreementId:source.id,termId:t.id,decision:'confirm'})
 }
 const amendment=await h.owner.command('legacy.import',{title:'synthetic-locket service amendment',type:'amendment',partyId:(await h.owner.state()).agreements.find(a=>a.id===source.id).party_id,sourceSystem:'Authorized archive',sourceId:crypto.randomUUID(),file:file('amendment.pdf',pdf('Service response amended to one business day.')),text:'Service response amended to one business day.',signed:true,restricted})
 const amendmentRow=(await h.owner.state()).agreements.find(a=>a.id===amendment.id)
 await h.owner.command('family.link',{agreementId:amendment.id,version:amendmentRow.version,parentId:source.id,relation:'amends'})
 if(restricted)await h.owner.command('access.set',{agreementId:amendment.id,operatorId:maker.id,grant:'grant'})
 const obligation=await h.owner.command('obligation.add',{agreementId:source.id,description:'Service availability review',ownerId:ownerId,dueDate:'2026-10-01',recurrence:'none',evidence:'note',citation:{quote:'Give 60 days notice.'}})
 await h.owner.command('obligation.update',{agreementId:source.id,obligationId:obligation.id,action:'confirm'})
 await h.owner.command('obligation.update',{agreementId:source.id,obligationId:obligation.id,action:'done',note:'September service report reviewed.'})
 await h.owner.command('comment.add',{agreementId:source.id,versionId:source.versionId,body:'Open issue: confirm next-year support coverage.'})
 const current=async()=> (await h.owner.state()).agreements.find(a=>a.id===source.id)
 if(restricted)await h.owner.command('access.set',{agreementId:source.id,operatorId:maker.id,grant:'grant'})
 await h.owner.command('renewal.cap.confirm',{agreementId:source.id,version:(await current()).version,value:'3% annually',citation:{quote}})
 await h.owner.command('accounting.link',{agreementId:source.id,version:(await current()).version,vendorId:'42',consent:true})
 await h.owner.command('renewal.brief.configure',{agreementId:source.id,version:(await current()).version,leadDays:14,decisionMakerId:maker.id})
 const draft=await h.owner.command('form.save',{definition:{name:'Supplier renewal',type:'supplier',fields:[{key:'contact',label:'Renewal contact',kind:'text',required:false,options:[],when:[]},{key:'security',label:'Security review',kind:'pick_list',required:true,options:['Enhanced review'],when:[]}],requirements:['Pricing schedule'],launch:{roles:['owner','approver'],audienceIds:[]},defaultRoute:{ownerId:maker.id,reviewerId:counsel.id,approvalRole:'counsel'},rules:[]}})
 const published=await h.owner.command('form.publish',draft)
 const s=await h.owner.state(),r=s.renewals.find(r=>r.agreement_id===source.id)
 return {source,maker,counsel,ownerId,published,quote,current,due:r.deadline_at-14*86400000}
}
