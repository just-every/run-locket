import {file,pdf} from './files.mjs'
import {PDFDocument,StandardFonts} from 'pdf-lib'

export const serviceLevelPolicy='Healthy time as a share of observed scheduled time (healthy + not passing). Unknown, paused and maintenance time are excluded from the uptime and SLA denominator and shown separately.'
export const serviceLevelBindings={UPTIME_ORIGIN:'https://synthetic-locket-uptime.example.test',UPTIME_METRICS_KEY:'synthetic-locket-1',MAIL_PROVIDER:'postmark',MAIL_API_KEY:'synthetic-locket-2',TEST_NOW:String(Date.parse('2026-10-17T14:00:00Z'))}
export function serviceLevelFake(calls,mode=()=> 'ok') {
 return async request=>{
  const url=new URL(request.url),selected=mode(),from=Date.parse(url.searchParams.get('from')),to=Date.parse(url.searchParams.get('to')),windowMs=to-from
  calls.push({url:request.url,authorization:request.headers.get('authorization'),method:request.method})
  if(selected==='refused')return Response.json({error:'Metrics key expired or revoked'},{status:401})
  if(selected==='oversized')return new Response(' '.repeat(2*1024*1024+1),{headers:{'content-type':'application/json'}})
  const unknownMs=selected==='zero'?windowMs:selected==='exclusions'?500:0,pausedMs=selected==='exclusions'?500:0,maintenanceMs=selected==='exclusions'?500:0,observedMs=windowMs-unknownMs-pausedMs-maintenanceMs
  const numerator=selected==='met'?1000:selected==='tier'?980:992,upMs=Math.floor(observedMs*numerator/1000),notPassingMs=observedMs-upMs
  const raw={schemaVersion:1,generatedAt:Number(serviceLevelBindings.TEST_NOW)-(selected==='stale'?600000:0),period:{period:'custom',from,to:to+(selected==='period'?1:0),timeZone:'UTC',slaTargetPercent:null},denominatorPolicy:selected==='policy'?'Different exclusions':serviceLevelPolicy,source:'uptime',monitors:[{id:selected==='monitor'?'synthetic-locket-other':url.searchParams.get('monitor'),availability:{uptimePercent:observedMs?Math.floor(upMs/observedMs*10000)/100:null,unknownPercent:unknownMs/windowMs*100,notPassingPercent:notPassingMs/windowMs*100,observedMs,upMs,notPassingMs,unknownMs,windowMs,pausedMs,maintenanceMs},latency:{statistics:{minMs:null,meanMs:null,p50Ms:null,p95Ms:null,p99Ms:null,maxMs:null,count:0},locations:[]},incidents:{count:1,durationInPeriodMs:notPassingMs},deliveries:[],current:{state:'Healthy',lastCheckAt:Number(serviceLevelBindings.TEST_NOW),coverage:{expected:1,observed:1},probes:[]}}]}
  const body=JSON.stringify(raw,null,2)+'\n'
  calls.at(-1).responseBody=body
  return new Response(body,{headers:{'content-type':'application/json','cache-control':'no-store'}})
 }
}
export async function serviceLevelFixture(h,{restricted=false,separateOwner=false,confirm=true,link=true,native=true,extraText=''}={}) {
 const counsel=await h.invite('synthetic-locket-counsel@example.test','counsel'),owner=separateOwner?await h.invite('synthetic-locket-agreement-owner@example.test','approver'):h.owner
 const ownerId=separateOwner?owner.id:(await h.owner.state()).actor.id
 const quote='Monthly availability must be at least 99.9%. Availability of 99.0% to below 99.9% earns a credit of 10% of the USD 10000 monthly service charge. Healthy time is divided by observed scheduled time; unknown, paused and maintenance time are excluded. The service month uses UTC. Claim by 23:59:59 UTC on the date 30 calendar days after the final service date.'
 const body=`Supplier hosting service, effective September 1, 2026. ${quote}${extraText?' '+extraText:''}`
 const signed=await PDFDocument.create(),font=await signed.embedFont(StandardFonts.Helvetica)
 signed.addPage([595,842]).drawText(body,{x:40,y:800,size:10,font,maxWidth:515,lineHeight:14})
 const bytes=Buffer.from(await signed.save())
 const details={title:'synthetic-locket monthly service SLA',type:'supplier',party:{name:'synthetic-locket supplier',kind:'supplier'},value:'120000',timezone:'UTC',file:file('service.pdf',bytes),text:body,restricted,ownerId}
 const source=await h.owner.command(native?'request.create':'legacy.import',native?details:{...details,sourceSystem:'Authorized archive',sourceId:crypto.randomUUID(),signed:true})
 const current=async()=>(await h.owner.state()).agreements.find(a=>a.id===source.id)
 if(native){
  for(const r of (await h.owner.state()).requirements.filter(r=>r.agreement_id===source.id))await h.owner.command('requirement.attach',{agreementId:source.id,requirementId:r.id,file:file('required.pdf',pdf(r.label))})
  await h.owner.command('agreement.submit',{agreementId:source.id,version:(await current()).version})
  await h.owner.command('approval.decide',{agreementId:source.id,version:(await current()).version,versionId:source.versionId,kind:'commercial',decision:'approved'})
  const packet=await h.owner.command('package.prepare',{agreementId:source.id,version:(await current()).version,provider:'paper',recipients:[{name:'Synthetic signer',email:'synthetic-locket-signer@example.test',action:'sign'}]})
  await h.owner.command('package.sent',{agreementId:source.id,version:(await current()).version,packageId:packet.packageId,envelopeId:'synthetic-locket-3'})
  await h.owner.command('execution.record',{agreementId:source.id,version:(await current()).version,envelopeId:'synthetic-locket-3',executedOn:'2026-09-01',documentConfirmed:true,signers:[{name:'Synthetic signer',email:'synthetic-locket-signer@example.test'}],signed:file('signed.pdf',bytes),certificate:file('certificate.pdf',pdf('Synthetic execution certificate'))})
 }
 const origin=serviceLevelBindings.UPTIME_ORIGIN,monitorId='synthetic-locket-4'
 const linkPayload=async()=>({agreementId:source.id,version:(await current()).version,origin,monitorId,consent:true})
 if(link)await h.owner.command('service-level.link',await linkPayload())
 const confirmPayload=async()=>({agreementId:source.id,version:(await current()).version,sourceAgreementId:source.id,citation:{quote},targetBps:9990,tierFloorBps:9900,creditBps:1000,monthlyBasis:'10000',timeZone:'UTC',claimDays:30,denominatorPolicy:serviceLevelPolicy,interpretation:'Monthly UTC availability uses healthy/observed scheduled time, excluding unknown, paused and maintenance time. The signed 99.0–99.9% tier credits 10% of the full USD 10000 monthly charge. Claim by 23:59:59 UTC, 30 calendar days after the final service date.',confirmExclusions:true,confirmFormula:true})
 if(confirm)await counsel.command('service-level.confirm',await confirmPayload())
 const read=(client=h.owner,month='2026-09')=>client.command('service-level.read',{agreementId:source.id,month})
 const claim=async id=>(await h.owner.state()).serviceLevels.claims.find(c=>c.id===id)
 const save=async(id,client=owner)=>{const f=await claim(id);return client.command('service-level.message',{claimId:id,claimVersion:f.version,recipient:'synthetic-locket-supplier@example.test',subject:f.subject,message:f.message_text})}
 const sendPayload=async id=>{const f=await claim(id);return {claimId:id,claimVersion:f.version,amountCents:f.amount_cents,messageDigest:f.message_digest,consent:true}}
 const approve=async(id,client=owner)=>client.command('service-level.approve',await sendPayload(id))
 return {source,counsel,owner,ownerId,quote,current,origin,monitorId,linkPayload,confirmPayload,read,claim,save,approve,sendPayload}
}
