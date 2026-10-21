import { file, pdf } from './files.mjs'
export const minute = 60_000
export const base = Date.parse('2026-10-22T12:00:00Z')
export const find = async (client, id) => (await client.state()).agreements.find(a => a.id === id)
export async function request(client, title, extra = {}) {
  return client.command('request.create', { title, type: 'nda', party: { name: 'Northwind Health', kind: 'customer' }, file: file('nda.pdf', pdf(`Mutual confidentiality agreement. ${title}`)), text: `Mutual confidentiality agreement. ${title}`, ...extra })
}
export async function submit(client, id) {
  return client.command('agreement.submit', { agreementId: id, version: (await find(client, id)).version })
}
export async function approve(client, id) {
  const a = await find(client, id)
  return client.command('approval.decide', { agreementId: id, version: a.version, versionId: a.current_version_id, kind: 'commercial', decision: 'approved' })
}
export async function dispatch(client, id) {
  let a = await find(client, id)
  const pkg = await client.command('package.prepare', { agreementId: id, version: a.version, provider: 'docusign', recipients: [{ name: 'Alex Morgan', email: 'alex@example.test', action: 'sign' }] })
  a = await find(client, id)
  await client.command('package.sent', { agreementId: id, version: a.version, packageId: pkg.packageId, envelopeId: `ENV-${id}` })
  return pkg
}
export async function finish(client, id, pkg) {
  const a = await find(client, id)
  const signed = Buffer.from(await (await client.request('/api/locket/files/' + pkg.pdfArtifactId)).arrayBuffer())
  return client.command('execution.record', { agreementId: id, version: a.version, envelopeId: `ENV-${id}`, executedOn: '2026-10-22', documentConfirmed: true, signers: [{ name: 'Alex Morgan', email: 'alex@example.test' }], signed: file('signed.pdf', signed), certificate: file('certificate.pdf', pdf('Provider certificate test fixture')) })
}

export async function timedRequests(h, count = 20) {
  const ids = []
  for (let i = 1; i <= count; i++) {
    const start = base + i * 120 * minute
    await h.setTime(start)
    const a = await request(h.owner, `Northwind NDA ${i}`); ids.push(a.id)
    await h.setTime(start + i * minute); await submit(h.owner, a.id)
    await h.setTime(start + 3 * i * minute); await approve(h.owner, a.id)
    await h.setTime(start + (3 * i + 1) * minute); const pkg = await dispatch(h.owner, a.id)
    await h.setTime(start + (6 * i + 1) * minute); await finish(h.owner, a.id, pkg)
  }
  return ids
}
