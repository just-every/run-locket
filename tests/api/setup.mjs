// Shared steps for the flow tests: people with roles, a library, and agreements
// walked to a given stage through the same public commands the interface uses.
import assert from 'node:assert/strict'
import { docx, file, pdf } from './files.mjs'

export async function team(h) {
  return {
    owner: h.owner,
    counsel: await h.invite('counsel@example.test', 'counsel'),
    approver: await h.invite('approver@example.test', 'approver'),
    requester: await h.invite('requester@example.test', 'requester'),
  }
}

export const templateBody = 'SUPPLY AGREEMENT\nBetween Olive Pty Ltd and {{counterparty}}.\nGoods: {{goods}}.\n[[clause:payment]]\n[[clause:liability]]\nGoverning law: New South Wales.'
export async function library(h, t) {
  const tpl = await t.counsel.command('template.create', {
    name: 'Supply agreement', type: 'supplier', body: templateBody,
    fields: [{ name: 'goods', label: 'Goods', required: true }],
    clauses: [
      { key: 'payment', title: 'Payment', variants: [{ id: 'net30', label: 'Net 30', text: 'Payment terms: invoices are payable within 30 days.' }, { id: 'net45', label: 'Net 45', text: 'Payment terms: invoices are payable within 45 days.' }] },
      { key: 'liability', title: 'Liability', variants: [{ id: 'cap', label: 'Capped', text: 'Liability is capped at the fees paid in the prior 12 months.' }] },
    ],
  })
  await t.counsel.command('template.decide', { versionId: tpl.versionId, decision: 'approve' })
  const playbook = await t.counsel.command('playbook.draft', {
    rules: [
      { key: 'payment', title: 'Payment terms', preferred: 'Invoices payable within 30 days.', alternatives: ['Invoices payable within 45 days.'], authority: 'approver' },
      { key: 'liability', title: 'Limitation of liability', preferred: 'Liability capped at 12 months of fees.', alternatives: [], authority: 'counsel' },
    ],
  })
  await t.counsel.command('playbook.activate', { id: playbook.id })
  return { templateVersionId: tpl.versionId, templateId: tpl.id, playbookId: playbook.id }
}

export async function agreement(h, t, lib, { title = 'Harbour supply', value = '48000', clause = 'net30', party = 'Harbour Supplies' } = {}) {
  const created = await t.requester.command('request.create', { title, type: 'supplier', party: { name: party, kind: 'supplier' }, value, templateVersionId: lib.templateVersionId, fields: { goods: 'Packaging' }, clauseChoices: { payment: clause } })
  const requirement = (await t.requester.state()).requirements.find(r => r.agreement_id === created.id)
  await t.requester.command('requirement.attach', { agreementId: created.id, requirementId: requirement.id, file: file('insurance.pdf', pdf('Certificate of currency')) })
  return created.id
}
export const find = async (client, id) => (await client.state()).agreements.find(a => a.id === id)

export async function submitted(h, t, lib, opts) {
  const id = await agreement(h, t, lib, opts)
  await t.requester.command('agreement.submit', { agreementId: id, version: (await find(t.requester, id)).version })
  return id
}
export async function approved(h, t, lib, opts) {
  const id = await submitted(h, t, lib, opts)
  const a = await find(t.approver, id)
  const result = await t.approver.command('approval.decide', { agreementId: id, version: a.version, versionId: a.current_version_id, kind: 'commercial', decision: 'approved' })
  assert.equal(result.status, 'approved')
  return id
}
export async function outForSignature(h, t, lib, opts) {
  const id = await approved(h, t, lib, opts)
  let a = await find(t.requester, id)
  const pkg = await t.requester.command('package.prepare', { agreementId: id, version: a.version, provider: 'docusign', recipients: [{ name: 'Hana Park', email: 'hana@harbour.example', action: 'sign' }, { name: 'Olive Owner', email: 'owner@example.test', action: 'sign' }] })
  a = await find(t.requester, id)
  await t.requester.command('package.sent', { agreementId: id, version: a.version, packageId: pkg.packageId, envelopeId: `ENV-${id.slice(0, 8)}` })
  return { id, pkg }
}
export async function executed(h, t, lib, opts) {
  const { id, pkg } = await outForSignature(h, t, lib, opts)
  const a = await find(t.requester, id)
  const result = await t.requester.command('execution.record', { agreementId: id, version: a.version, envelopeId: `ENV-${id.slice(0, 8)}`, executedOn: '2026-07-01', documentConfirmed: true, signers: [{ name: 'Hana Park', email: 'hana@harbour.example' }, { name: 'Olive Owner', email: 'owner@example.test' }], signed: file('signed.pdf', pdf(`Signed ${id}`)), certificate: file('Summary.pdf', pdf(`Certificate ${id}`)) })
  assert.equal(result.status, 'reconciled')
  return { id, pkg }
}
export { docx, file, pdf }
