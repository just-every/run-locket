// Synthetic evidence enters exclusively through the product's public commands.
import { file, pdf } from './files.mjs'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { serviceLevelBindings, serviceLevelPolicy } from './service-level-fixture.mjs'
import { dispatch, finish, find, stage } from './analytics-fixture.mjs'
export const fallback = 'Liability is capped at the fees paid in the prior 24 months.'
export const preferred = 'Liability is capped at the fees paid in the prior 12 months.'
export const recommendationScope = { agreementTypes: ['supplier'], entityIds: [] }
export const minute = 60_000
const priceQuote = 'Annual price increases shall not exceed 3 percent.'
const slaQuote = 'Monthly availability must be at least 99.9%. Availability of 99.0% to below 99.9% earns a credit of 10% of the USD 10000 monthly service charge. Healthy time is divided by observed scheduled time; unknown, paused and maintenance time are excluded. The service month uses UTC. Claim by 23:59:59 UTC on the date 30 calendar days after the final service date.'
async function readableCohortPdf(contents) {
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica)
 doc.addPage([595,842]).drawText(contents,{x:40,y:800,size:10,font,maxWidth:515,lineHeight:14})
 return Buffer.from(await doc.save())
}

export async function attachNegotiationRequirements(client,id) {
 for(const r of (await client.state()).requirements.filter(r=>r.agreement_id===id))await client.command('requirement.attach',{agreementId:id,requirementId:r.id,file:file('synthetic-locket-attachment.pdf',pdf(r.label))})
}

export async function negotiationFixture(h, { count = 30, nativeCredit = false } = {}) {
  const counsel = await h.invite('synthetic-locket-counsel@example.test', 'counsel')
  const source = await counsel.command('playbook.draft', { rules: [{ key: 'liability', title: 'Limitation of liability', preferred, alternatives: [], authority: 'counsel' }] })
  await counsel.command('playbook.activate', { id: source.id })
  const base = Date.parse('2026-10-23T12:00:00Z'), rows = []
  for (let i = 0; i < count; i++) {
    const at = base + i * 120 * minute
    await h.setTime(at)
    const contents = `synthetic-locket-${i + 1}\n${nativeCredit && i === 0 ? priceQuote + '\n' + slaQuote + '\n' : ''}${fallback}`
    const created = await h.owner.command('request.create', { title: `synthetic-locket-${i + 1}`, type: 'supplier', party: { name: `synthetic-locket-party-${i + 1}`, kind: 'supplier' }, file: file(`synthetic-locket-${i + 1}.pdf`, nativeCredit && i === 0 ? await readableCohortPdf(contents) : pdf(contents)), text: contents, restricted: i === 0 })
    await attachNegotiationRequirements(h.owner,created.id)
    await h.setTime(at + 10 * minute); await stage(h.owner, created.id, 'negotiation')
    const finding = await counsel.command('deviation.add', { agreementId: created.id, versionId: created.versionId, clauseKey: 'liability', result: 'breached', start: contents.indexOf(fallback), end: contents.indexOf(fallback) + fallback.length, quote: fallback, proposedWording: preferred, explanation: 'Counterparty requests the 24-month cap.', questions: [] })
    await h.setTime(at + 20 * minute)
    await h.owner.command('agreement.submit', { agreementId: created.id, version: (await find(h.owner, created.id)).version })
    await h.setTime(at + 30 * minute)
    await h.owner.command('approval.decide', { agreementId: created.id, version: (await find(h.owner, created.id)).version, versionId: created.versionId, kind: 'commercial', decision: 'approved' })
    await h.setTime(at + 50 * minute)
    const approval = await counsel.command('approval.decide', { agreementId: created.id, version: (await find(counsel, created.id)).version, versionId: created.versionId, kind: 'exception', deviationId: finding.id, decision: 'approved', reason: 'Authorized this exact offered wording for the recorded negotiation.' })
    await h.setTime(at + 51 * minute)
    const payload = { agreementId: created.id, version: (await find(counsel, created.id)).version, versionId: created.versionId, deviationId: finding.id, approvalId: approval.id, outcome: i < 22 ? 'accepted' : 'rejected', evidence: `synthetic-locket-counterparty-reply-${i + 1}: explicitly ${i < 22 ? 'accepted' : 'rejected'} the quoted 24-month cap.` }
    const outcome = await counsel.command('negotiation.outcome.record', payload)
    rows.push({ ...created, findingId: finding.id, approvalId: approval.id, outcomeId: outcome.id, payload })
    if (i === 0) {
      const pkg = await dispatch(h.owner, created.id)
      await finish(h.owner, created.id, pkg)
      rows[0].packageId = pkg.packageId
      rows[0].signedArtifactId = (await h.owner.state()).executions.find(e => e.agreement_id === created.id).signed_artifact_id
    }
  }
  await h.setTime(base + count * 120 * minute)
  let credit
  if (nativeCredit) credit = await nativeCreditFinding(h,counsel,rows[0])
  const observation = nativeCredit ? null : await counsel.command('playbook.issue.record', { agreementId: rows[0].id, version: (await find(counsel, rows[0].id)).version, outcomeId: rows[0].outcomeId, kind: 'credit', description: 'A later service credit was agreed for this agreement.', evidence: 'synthetic-locket-credit-1: recorded credit after the negotiated cap was accepted.' })
  return { counsel, source, rows, observation, credit, scope: recommendationScope }
}

export async function recommendFixture(f) {
  return f.counsel.command('playbook.recommend', { sourcePlaybookId: f.source.id, clauseKey: 'liability', scope: f.scope })
}

// One actual native AGENT-001 finding on an executed cohort agreement. Only the
// QuickBooks fetch response is faked by the installation's network edge.
async function nativeCreditFinding(h,counsel,agreement) {
 const finance=await h.invite('synthetic-locket-credit-finance@example.test','approver')
 await h.owner.command('access.set',{agreementId:agreement.id,operatorId:finance.id,grant:'grant'})
 const current=()=>find(h.owner,agreement.id),ownerId=(await h.owner.state()).actor.id
 await h.owner.command('service-level.link',{agreementId:agreement.id,version:(await current()).version,origin:serviceLevelBindings.UPTIME_ORIGIN,monitorId:'synthetic-locket-cohort-monitor',consent:true})
 await h.owner.command('accounting.link',{agreementId:agreement.id,version:(await current()).version,vendorId:'42',consent:true})
 await h.owner.command('reconciliation.configure',{agreementId:agreement.id,version:(await current()).version,counselId:counsel.id,financeId:finance.id,ownerId,consent:true})
 await counsel.command('reconciliation.interpret',{agreementId:agreement.id,version:(await current()).version,sourceAgreementId:agreement.id,capBps:300,interpretation:'One annual increase for identical annual services. Finance must confirm the complete annual allocation, taxes and credits.',citation:{quote:priceQuote},confirmAnnualComparableBasis:true})
 const scan=await h.owner.command('reconciliation.scan',{agreementId:agreement.id,since:'2025-01-01',through:'2026-10-17'})
 const finding=await h.owner.command('reconciliation.prepare',{agreementId:agreement.id,scanId:scan.id,baselineBillId:'synthetic-locket-3',billId:'synthetic-locket-4'})
 await counsel.command('service-level.confirm',{agreementId:agreement.id,version:(await current()).version,sourceAgreementId:agreement.id,citation:{quote:slaQuote},targetBps:9990,tierFloorBps:9900,creditBps:1000,monthlyBasis:'10000',timeZone:'UTC',claimDays:30,denominatorPolicy:serviceLevelPolicy,interpretation:'Monthly UTC healthy/observed scheduled time excludes unknown, paused and maintenance. The signed 99.0 to below 99.9 percent tier credits 10 percent of USD 10000. Claim within 30 calendar days after the final service date.',confirmExclusions:true,confirmFormula:true})
 const read=await h.owner.command('service-level.read',{agreementId:agreement.id,month:'2026-09'})
 const serviceRecord=async()=>(await h.owner.state()).serviceLevels.claims.find(r=>r.id===read.claimId)
 const serviceCredit={id:read.claimId,quote:slaQuote,approve:async()=>{
  let r=await serviceRecord()
  await h.owner.command('service-level.message',{claimId:r.id,claimVersion:r.version,recipient:'synthetic-locket-credit-supplier@example.test',subject:r.subject,message:r.message_text})
  r=await serviceRecord()
  await h.owner.command('service-level.approve',{claimId:r.id,claimVersion:r.version,amountCents:r.amount_cents,messageDigest:r.message_digest,consent:true})
 },send:async()=>{const r=await serviceRecord();return h.owner.command('service-level.email',{claimId:r.id,claimVersion:r.version,amountCents:r.amount_cents,messageDigest:r.message_digest,consent:true})}}
 const record=async()=>(await h.owner.state()).reconciliationFindings.find(r=>r.id===finding.id)
 const approve=async()=>{
  await finance.command('reconciliation.finance.confirm',{findingId:finding.id,findingVersion:(await record()).version,confirmComparable:true,confirmAdjustments:true,note:'Same full annual services and quantities, allocated wholly to this agreement. Both bills exclude tax; no credits or adjustments apply.'})
  let r=await record()
  await h.owner.command('reconciliation.message.edit',{findingId:r.id,findingVersion:r.version,recipient:'synthetic-locket-credit-supplier@example.test',subject:r.subject,message:r.message_text})
  r=await record()
  await h.owner.command('reconciliation.message.approve',{findingId:r.id,findingVersion:r.version,messageDigest:r.message_digest,consent:true})
 }
 const send=async()=>{const r=await record();return h.owner.command('reconciliation.email',{findingId:r.id,findingVersion:r.version,messageDigest:r.message_digest,consent:true})}
 return {id:finding.id,quote:priceQuote,record,approve,send,serviceCredit}
}
