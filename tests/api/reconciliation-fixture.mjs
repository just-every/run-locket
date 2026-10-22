import { file,pdf } from './files.mjs'
import { accountingBindings } from './renewal-brief-fixture.mjs'

export const reconciliationBindings={...accountingBindings,POSTMARK_SERVER_TOKEN:'synthetic-locket-2',TEST_NOW:String(Date.parse('2026-10-17T14:00:00Z'))}
// QuickBooks' real query response is faked only at fetch. Purse has no published
// machine-authorized PO read API; inventing a successful Purse fake would hide it.
export function reconciliationFake(calls,mode=()=> 'ok') {
 return async request=>{
  const url=new URL(request.url),query=url.searchParams.get('query')
  calls.push({url:url.origin+url.pathname,query,authorization:request.headers.get('authorization')})
  if(mode()==='refused')return Response.json({Fault:{}},{status:401})
  const values=[['synthetic-locket-3','2025-01-01',100000],['synthetic-locket-4','2026-01-01',107000],['synthetic-locket-5','2026-02-01',107000]]
  const Bill=values.map(([Id,TxnDate,TotalAmt])=>({Id,TxnDate,TotalAmt,VendorRef:{value:'42'},CurrencyRef:{value:mode()==='currency'?'EUR':'USD'},Balance:mode()==='paid'?0:TotalAmt}))
  return Response.json({QueryResponse:{Bill}})
 }
}
export async function reconciliationFixture(h,{restricted=false,native=true,separateOwner=false,interpret=true}={}) {
 const counsel=await h.invite('synthetic-locket-counsel@example.test','counsel'),finance=await h.invite('synthetic-locket-finance@example.test','approver')
 const owner=separateOwner?await h.invite('synthetic-locket-finding-owner@example.test','requester'):h.owner
 const ownerId=separateOwner?owner.id:(await h.owner.state()).actor.id
 const quote='Annual price increases shall not exceed 3 percent.'
 const body=`${quote} Annual supplier services are USD 100000 for the same service scope. The baseline annual service period is January through December 2025; the next period is January through December 2026.`
 const bytes=pdf(body),details={title:'synthetic-locket supplier reconciliation',type:'supplier',party:{name:'synthetic-locket supplier',kind:'supplier'},value:'100000',file:file('supplier.pdf',bytes),text:body,restricted}
 const source=await h.owner.command(native?'request.create':'legacy.import',native?details:{...details,sourceSystem:'Authorized archive',sourceId:crypto.randomUUID(),signed:true})
 const current=async()=>(await h.owner.state()).agreements.find(a=>a.id===source.id)
 if(native){
  for(const r of (await h.owner.state()).requirements.filter(r=>r.agreement_id===source.id))await h.owner.command('requirement.attach',{agreementId:source.id,requirementId:r.id,file:file('required.pdf',pdf(r.label))})
  await h.owner.command('agreement.submit',{agreementId:source.id,version:(await current()).version})
  await h.owner.command('approval.decide',{agreementId:source.id,version:(await current()).version,versionId:source.versionId,kind:'commercial',decision:'approved'})
  const packet=await h.owner.command('package.prepare',{agreementId:source.id,version:(await current()).version,provider:'paper',recipients:[{name:'Synthetic signer',email:'synthetic-locket-signer@example.test',action:'sign'}]})
  await h.owner.command('package.sent',{agreementId:source.id,version:(await current()).version,packageId:packet.packageId,envelopeId:'synthetic-locket-6'})
  await h.owner.command('execution.record',{agreementId:source.id,version:(await current()).version,envelopeId:'synthetic-locket-6',executedOn:'2026-10-17',documentConfirmed:true,signers:[{name:'Synthetic signer',email:'synthetic-locket-signer@example.test'}],signed:file('signed.pdf',bytes),certificate:file('certificate.pdf',pdf('Synthetic execution certificate'))})
 }
 if(restricted)for(const person of [finance,...(separateOwner?[owner]:[])])await h.owner.command('access.set',{agreementId:source.id,operatorId:person.id,grant:'grant'})
 await h.owner.command('accounting.link',{agreementId:source.id,version:(await current()).version,vendorId:'42',consent:true})
 await h.owner.command('reconciliation.configure',{agreementId:source.id,version:(await current()).version,counselId:counsel.id,financeId:finance.id,ownerId,consent:true})
 const interpretationPayload=async()=>({agreementId:source.id,version:(await current()).version,sourceAgreementId:source.id,capBps:300,interpretation:'One annual price increase for identical services and quantities. Compare the 2026 full annual charge with the 2025 full annual charge, excluding no portion; finance must verify tax and credit effects.',citation:{quote},confirmAnnualComparableBasis:true})
 if(interpret)await counsel.command('reconciliation.interpret',await interpretationPayload())
 const read=()=>h.owner.command('reconciliation.scan',{agreementId:source.id,since:'2025-01-01',through:'2026-10-17'})
 const prepare=async(scanId,billId='synthetic-locket-4',client=h.owner)=>client.command('reconciliation.prepare',{agreementId:source.id,scanId,baselineBillId:'synthetic-locket-3',billId})
 const record=async id=>(await h.owner.state()).reconciliationFindings.find(f=>f.id===id)
 const confirm=async id=>finance.command('reconciliation.finance.confirm',{findingId:id,findingVersion:(await record(id)).version,confirmComparable:true,confirmAdjustments:true,note:'Compared full 2025 and 2026 annual charges for unchanged services/quantities, allocated wholly to this contract. Both exclude tax, and the accounting ledger shows no credit or adjustment against this charge.'})
 const save=async(id,client=owner)=>{const f=await record(id);return client.command('reconciliation.message.edit',{findingId:id,findingVersion:f.version,recipient:'synthetic-locket-supplier@example.test',subject:f.subject,message:f.message_text})}
 const approve=async(id,client=owner)=>{const f=await record(id);return client.command('reconciliation.message.approve',{findingId:id,findingVersion:f.version,messageDigest:f.message_digest,consent:true})}
 const sendPayload=async id=>{const f=await record(id);return {findingId:id,findingVersion:f.version,messageDigest:f.message_digest,consent:true}}
 return {source,counsel,finance,owner,ownerId,quote,current,interpretationPayload,read,prepare,record,confirm,save,approve,sendPayload}
}
