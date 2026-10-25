import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { installation } from './harness.mjs'
import { renewalScenario } from './portfolio-fixture.mjs'
import { serviceLevelBindings, serviceLevelFake, serviceLevelFixture } from './service-level-fixture.mjs'
import { accountingBindings } from './renewal-brief-fixture.mjs'
import { file, pdf } from './files.mjs'

const at=Date.parse
const report=async(client,month='2026-10')=>{const r=await client.request('/api/locket/outcome-report?month='+month);assert.equal(r.status,200,await r.clone().text());return r.json()}
const advance=async(h,value)=>{await h.setTime(at(value));h.owner=await h.signIn('owner@example.test')}
const current=async(h,id)=>(await h.owner.state()).agreements.find(a=>a.id===id)
const chosen=async(h,ids)=>{const s=await h.owner.state();return s.accountingLinks.filter(l=>ids.includes(l.agreement_id)).map(l=>({agreementId:l.agreement_id,version:l.version,vendorId:l.vendor_id}))}
const scalar=async(h,query,...args)=>(await h.db.prepare(query).bind(...args).first()).n

// Test fixtures use the real command, clock, import and scheduler doors. Only
// external QuickBooks/Uptime/mail calls are replaced at the network edge.
test('AGENT-009 fixture-year source counts and exact USD totals match the retained records and each recipient’s current access',async t=>{
 const bills=[{id:'synthetic-locket-baseline',date:'2025-01-01',total:100000},{id:'synthetic-locket-increase',date:'2026-01-01',total:107000},{id:'synthetic-locket-post-end',date:'2026-10-12',total:321.25}]
 const calls=[],uptime=serviceLevelFake([]),h=await installation({bindings:{...serviceLevelBindings,...accountingBindings,TEST_NOW:String(at('2025-11-01T12:00:00Z'))},outboundResponse:async request=>{
  if(new URL(request.url).origin===serviceLevelBindings.UPTIME_ORIGIN)return uptime(request)
  const query=new URL(request.url).searchParams.get('query');calls.push(query)
  const from=query.match(/TxnDate >= '([^']+)'/)[1],through=query.match(/TxnDate <= '([^']+)'/)[1]
  return Response.json({QueryResponse:{Bill:bills.filter(b=>b.date>=from&&b.date<=through).map(b=>({Id:b.id,TxnDate:b.date,TotalAmt:b.total,Balance:0,VendorRef:{value:'42'},CurrencyRef:{value:'USD'}}))}})
 }});t.after(()=>h.close())
 const live=await renewalScenario(h.owner,{effective_date:'2025-11-01',end_date:'2025-11-30',renewal_term_months:'1',notice_days:'0'},'synthetic-locket-live-year')
 const ownerId=(await h.owner.state()).actor.id
 for(let i=0;i<12;i++){
  const date=new Date(Date.UTC(2025,10+i,1)),month=date.toISOString().slice(0,7)
  await advance(h,month+'-01T12:00:00Z')
  let supplier
  for(const side of ['ours','supplier']){
   const o=await h.owner.command('obligation.add',{agreementId:live.id,description:`synthetic-locket ${side} duty ${month}`,ownerId,dueDate:month+'-10',recurrence:'none',citation:{quote:live.quote}})
   await h.owner.command('obligation.update',{agreementId:live.id,obligationId:o.id,action:'confirm'})
   await h.owner.command('outcome-report.classify',{obligationId:o.id,version:(await current(h,live.id)).version,side,confirmCitation:true,reason:'The cited signed clause assigns this fixture duty to the recorded side.'})
   if(side==='supplier')supplier=o
  }
  await advance(h,month+'-12T12:00:00Z')
  await h.owner.command('obligation.update',{agreementId:live.id,obligationId:supplier.id,action:'done',note:'Supplier evidence reviewed two days after the due date.'})
  await h.scheduled(at(month+'-12T12:00:00Z'))
 }
 await advance(h,'2026-10-17T14:00:00Z')
 const f=await serviceLevelFixture(h,{native:true,restricted:true,extraText:'Annual price increases shall not exceed 3 percent.'})
 const credit=await f.read()
 await h.owner.command('accounting.link',{agreementId:f.source.id,version:(await current(h,f.source.id)).version,vendorId:'42',consent:true})
 await h.owner.command('reconciliation.configure',{agreementId:f.source.id,version:(await current(h,f.source.id)).version,counselId:f.counsel.id,financeId:ownerId,ownerId,consent:true})
 await f.counsel.command('reconciliation.interpret',{agreementId:f.source.id,version:(await current(h,f.source.id)).version,sourceAgreementId:f.source.id,capBps:300,interpretation:'One annual increase on the full unchanged annual service charge; finance must confirm allocation and adjustments.',citation:{quote:'Annual price increases shall not exceed 3 percent.'},confirmAnnualComparableBasis:true})
 const scan=await h.owner.command('reconciliation.scan',{agreementId:f.source.id,since:'2025-01-01',through:'2026-10-17'})
 const finding=await h.owner.command('reconciliation.prepare',{agreementId:f.source.id,scanId:scan.id,baselineBillId:bills[0].id,billId:bills[1].id})
 for(const [key,value]of [['effective_date','2026-09-01'],['end_date','2026-09-30'],['auto_renew','no'],['notice_days','0']]){const term=await h.owner.command('term.propose',{agreementId:f.source.id,key,value,citation:{quote:f.quote}});await h.owner.command('term.decide',{agreementId:f.source.id,termId:term.id,decision:'confirm'})}
 const imported=await renewalScenario(h.owner,{effective_date:'2025-11-01',end_date:'2025-11-30',renewal_term_months:'1',notice_days:'0'},'synthetic-locket-imported-year')
 await advance(h,'2026-11-02T12:00:00Z');await h.scheduled(at('2026-11-02T12:00:00Z'))
 const viewer=await h.invite('synthetic-locket-outcome-reader@example.test','viewer'),accountingLinks=await chosen(h,[f.source.id])
 await h.owner.command('outcome-report.configure',{version:0,recipients:[ownerId,viewer.id],accountingLinks,enabled:true,consent:true})
 const out=await report(h.owner),visible=await report(viewer)
 assert.equal(out.months.length,12)
 for(const m of out.months){
  const due=await scalar(h,"SELECT count(*) n FROM lk_obligations WHERE status IN ('confirmed','done') AND substr(due_date,1,7)=? AND (done_at IS NULL OR done_at>CAST(strftime('%s',due_date||'T23:59:59Z') AS INTEGER)*1000)",m.month)
  const renewals=await scalar(h,"SELECT count(*) n FROM (SELECT agreement_id,deadline_at FROM lk_renewal_history WHERE committed=1 AND derived_at_import=0 AND decision IS NULL AND substr(deadline_date,1,7)=? GROUP BY agreement_id,deadline_at)",m.month)
  assert.equal(m.figures.deadlinesMissed.count,due+renewals,m.month)
  assert.equal(m.figures.renewedWithoutDecision.count,renewals,m.month)
  assert.equal(m.figures.deadlinesLate.count,await scalar(h,"SELECT count(*) n FROM lk_obligations WHERE status='done' AND strftime('%Y-%m',done_at/1000,'unixepoch')=? AND done_at>CAST(strftime('%s',due_date||'T23:59:59Z') AS INTEGER)*1000",m.month))
  const cutoff=Date.parse(new Date(Date.parse(m.month+'-01T00:00:00Z')).toISOString().slice(0,7)+'-01T00:00:00Z'),next=new Date(cutoff);next.setUTCMonth(next.getUTCMonth()+1)
  for(const [key,side]of [['overdueOurs','ours'],['overdueSupplier','supplier'],['overdueUnclassified','unclassified']])assert.equal(m.figures[key].count,await scalar(h,"SELECT count(*) n FROM lk_obligations WHERE status IN ('confirmed','done') AND responsible_side=? AND due_date<? AND created_at<? AND (done_at IS NULL OR done_at>=?)",side,next.toISOString().slice(0,10),next.getTime(),next.getTime()),`${m.month} ${key}`)
  assert.equal(m.figures.overchargesFound.cents,await scalar(h,"SELECT COALESCE(sum(json_extract(content,'$.atStakeCents')),0) n FROM lk_reconciliation_findings WHERE status<>'rejected' AND strftime('%Y-%m',created_at/1000,'unixepoch')=?",m.month))
  assert.equal(m.figures.creditsFound.cents,await scalar(h,"SELECT COALESCE(sum(amount_cents),0) n FROM lk_service_level_claims WHERE strftime('%Y-%m',created_at/1000,'unixepoch')=?",m.month))
  assert.equal(m.figures.creditsRecovered.cents,null);assert.equal(m.figures.creditsRecovered.count,null)
  for(const figure of Object.values(m.figures)){if(figure.count!==null)assert.equal(figure.count,figure.evidence.length);for(const e of figure.evidence){assert.ok(e.recordId&&e.agreementId&&e.href.startsWith('/app#agreement/'));assert.ok(e.details&&Object.keys(e.details).length)}}
 }
 const october=out.months.at(-1)
 assert.equal(october.figures.creditsFound.cents,100000);assert.equal(october.figures.overchargesFound.cents,400000);assert.equal(october.figures.pastEndSpend.cents,32125)
 assert.equal(october.figures.pastEndSpend.evidence[0].recordId,bills[2].id)
 assert.ok(october.figures.creditsFound.evidence.some(e=>e.recordId===credit.claimId));assert.ok(october.figures.overchargesFound.evidence.some(e=>e.recordId===finding.id))
 assert.ok((await h.owner.state()).renewalHistory.some(r=>r.agreement_id===imported.id&&r.derived_at_import===1))
 assert.ok(out.months.some(m=>m.figures.renewedWithoutDecision.count>0));assert.ok(!JSON.stringify(visible).includes(f.source.id));assert.equal(visible.months.at(-1).figures.creditsFound.cents,0)
 const before=h.mails.length,id=randomUUID(),send={month:'2026-10',version:1,consent:true}
 await h.owner.command('outcome-report.deliver',send,{commandId:id});await h.owner.command('outcome-report.deliver',send,{commandId:id});await h.owner.command('outcome-report.deliver',send)
 const mails=h.mails.slice(before).filter(mail=>mail.subject==='Your monthly Locket report is ready');assert.equal(mails.length,2)
 for(const mail of mails){assert.equal(mail.attachments?.length??0,0);assert.doesNotMatch(JSON.stringify(mail),/321\.25|4000|synthetic-locket monthly service|synthetic-locket-post-end/);assert.match(mail.text,/#outcome-report\/2026-10/)}
 const state=await h.owner.state();assert.equal(state.outcomeReports.deliveries.filter(d=>d.status==='accepted').length,2);assert.ok(state.audit.some(a=>a.action==='outcome-report.read'&&a.actor_role==='scheduler'&&a.agreement_id===f.source.id));assert.ok(calls.length>0)
 await advance(h,'2026-12-02T12:00:00Z');const monthlyBefore=h.mails.length
 await h.scheduled(at('2026-12-02T12:00:00Z'));await h.scheduled(at('2026-12-02T12:00:00Z'))
 const monthly=(await h.owner.state()).outcomeReports.deliveries.filter(d=>d.month==='2026-11')
 assert.equal(monthly.length,2);assert.ok(monthly.every(d=>d.status==='accepted'));assert.equal(h.mails.slice(monthlyBefore).filter(mail=>mail.subject==='Your monthly Locket report is ready').length,2)
})

test('AGENT-009 consent, source and access changes remain scoped and rejected or uncertain monthly mail is never retried',async t=>{
 let mode='ok',mailMode='ok',calls=0
 const h=await installation({bindings:{...accountingBindings,TEST_NOW:String(at('2026-10-20T12:00:00Z'))},outboundResponse:async()=>{calls++;return mode==='ok'?Response.json({QueryResponse:{Bill:[{Id:'synthetic-locket-visible-bill',TxnDate:'2026-08-05',TotalAmt:25,Balance:0,VendorRef:{value:'42'},CurrencyRef:{value:'USD'}}]}}):Response.json({Fault:{}},{status:401})},mailResponse:mail=>{
  if(!mail.subject.includes('monthly Locket'))return Response.json({id:'synthetic-locket-auth'})
  return mailMode==='rejected'?Response.json({message:'Rejected'},{status:422}):mailMode==='uncertain'?new Response('Unknown outcome',{status:503}):Response.json({id:'synthetic-locket-mail'})
 }});t.after(()=>h.close())
 const ownerId=(await h.owner.state()).actor.id,viewer=await h.invite('synthetic-locket-outcome-viewer@example.test','viewer')
 const a=await h.owner.command('legacy.import',{title:'synthetic-locket restricted ended supplier',type:'supplier',party:{name:'synthetic-locket vendor',kind:'supplier'},restricted:true,sourceSystem:'Authorized archive',sourceId:'synthetic-locket-ended',file:file('ended.pdf',pdf('Agreed terms.')),text:'Agreed terms.',signed:true})
 for(const [key,value]of [['effective_date','2026-01-01'],['end_date','2026-02-01'],['auto_renew','no'],['notice_days','0']]){const term=await h.owner.command('term.propose',{agreementId:a.id,key,value,citation:{quote:'Agreed terms.'}});await h.owner.command('term.decide',{agreementId:a.id,termId:term.id,decision:'confirm'})}
 await h.owner.command('accounting.link',{agreementId:a.id,version:(await current(h,a.id)).version,vendorId:'42',consent:true})
 const payload={version:0,recipients:[ownerId,viewer.id],accountingLinks:await chosen(h,[a.id]),enabled:true,consent:true}
 await viewer.command('outcome-report.configure',payload,{error:'FORBIDDEN'});await h.owner.command('outcome-report.configure',{...payload,consent:false},{error:'CONSENT'})
 await h.owner.command('outcome-report.configure',payload)
 assert.equal((await h.request('/api/locket/outcome-report?month=2026-09')).status,401)
 assert.equal((await h.owner.request('/api/locket/outcome-report?month=2026-10')).status,400)
 const before=calls;await report(viewer,'2026-09');assert.equal(calls,before,'No inaccessible accounting vendor is queried')
 await h.owner.command('access.set',{agreementId:a.id,operatorId:viewer.id,grant:'grant'})
 assert.ok(JSON.stringify(await report(viewer,'2026-09')).includes(a.id))
 await h.owner.command('access.set',{agreementId:a.id,operatorId:viewer.id,grant:'revoke'})
 assert.ok(!JSON.stringify(await report(viewer,'2026-09')).includes(a.id))
 mode='refused';const unavailable=(await report(h.owner,'2026-09')).months.at(-1).figures.pastEndSpend
 assert.equal(unavailable.cents,null);assert.equal(unavailable.count,null);assert.ok(unavailable.unavailable.length)
 await h.owner.command('accounting.link',{agreementId:a.id,version:(await current(h,a.id)).version,vendorId:'43',consent:true})
 assert.match(JSON.stringify(await report(h.owner,'2026-09')),/Accounting consent changed/)
 await h.owner.command('outcome-report.deliver',{month:'2026-09',version:1,consent:false},{error:'CONSENT'})
 const monthlyMails=()=>h.mails.filter(m=>m.subject==='Your monthly Locket report is ready'),alerts=()=>h.mails.filter(m=>m.subject==='A Locket connection needs attention'),priorAlerts=alerts().length
 for(const [month,outcome]of [['2026-08','rejected'],['2026-09','uncertain']]){mailMode=outcome;const before=monthlyMails().length;await h.owner.command('outcome-report.deliver',{month,version:1,consent:true});await h.owner.command('outcome-report.deliver',{month,version:1,consent:true});assert.equal(monthlyMails().length,before+2);assert.ok((await h.owner.state()).outcomeReports.deliveries.filter(d=>d.month===month).every(d=>d.status===outcome))}
 assert.equal(alerts().length,priorAlerts+1,'One generic owner alert accompanies the mail incident; the two monthly recipients are never retried')
 const health=(await h.owner.state()).connections.find(c=>c.id==='mail');assert.equal(health.status,'failing');assert.equal(health.alert_status,'accepted')
 await h.owner.command('repository.access',{version:0,enabled:false,grants:[],hiddenFields:[{role:'viewer',fields:['value']}]})
 assert.equal((await viewer.request('/api/locket/outcome-report?month=2026-09')).status,403)
 await h.owner.command('outcome-report.configure',{...payload,version:1,accountingLinks:[],recipients:[ownerId],enabled:false})
 await h.scheduled(at('2026-11-02T12:00:00Z'))
 assert.equal((await h.owner.state()).outcomeReports.settings.enabled,0)
})
