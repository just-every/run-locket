// Synthetic evidence enters exclusively through the product's public commands.
import { file, pdf } from './files.mjs'
import { dispatch, finish, find, stage } from './analytics-fixture.mjs'
export const fallback = 'Liability is capped at the fees paid in the prior 24 months.'
export const preferred = 'Liability is capped at the fees paid in the prior 12 months.'
export const recommendationScope = { agreementTypes: ['supplier'], entityIds: [] }
export const minute = 60_000

export async function attachNegotiationRequirements(client,id) {
 for(const r of (await client.state()).requirements.filter(r=>r.agreement_id===id))await client.command('requirement.attach',{agreementId:id,requirementId:r.id,file:file('synthetic-locket-attachment.pdf',pdf(r.label))})
}

export async function negotiationFixture(h, { count = 30 } = {}) {
  const counsel = await h.invite('synthetic-locket-counsel@example.test', 'counsel')
  const source = await counsel.command('playbook.draft', { rules: [{ key: 'liability', title: 'Limitation of liability', preferred, alternatives: [], authority: 'counsel' }] })
  await counsel.command('playbook.activate', { id: source.id })
  const base = Date.parse('2026-10-23T12:00:00Z'), rows = []
  for (let i = 0; i < count; i++) {
    const at = base + i * 120 * minute
    await h.setTime(at)
    const contents = `synthetic-locket-${i + 1}\n${fallback}`
    const created = await h.owner.command('request.create', { title: `synthetic-locket-${i + 1}`, type: 'supplier', party: { name: `synthetic-locket-party-${i + 1}`, kind: 'supplier' }, file: file(`synthetic-locket-${i + 1}.pdf`, pdf(contents)), text: contents, restricted: i === 0 })
    await attachNegotiationRequirements(h.owner,created.id)
    await h.setTime(at + 10 * minute); await stage(h.owner, created.id, 'negotiation')
    const finding = await counsel.command('deviation.add', { agreementId: created.id, versionId: created.versionId, clauseKey: 'liability', result: 'breached', start: contents.indexOf(fallback), end: contents.length, quote: fallback, proposedWording: preferred, explanation: 'Counterparty requests the 24-month cap.', questions: [] })
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
  const observation = await counsel.command('playbook.issue.record', { agreementId: rows[0].id, version: (await find(counsel, rows[0].id)).version, outcomeId: rows[0].outcomeId, kind: 'credit', description: 'A later service credit was agreed for this agreement.', evidence: 'synthetic-locket-credit-1: recorded credit after the negotiated cap was accepted.' })
  return { counsel, source, rows, observation, scope: recommendationScope }
}

export async function recommendFixture(f) {
  return f.counsel.command('playbook.recommend', { sourcePlaybookId: f.source.id, clauseKey: 'liability', scope: f.scope })
}
