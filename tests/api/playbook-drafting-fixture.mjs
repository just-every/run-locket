import assert from 'node:assert/strict'
import { file, pdf, docx } from './files.mjs'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { approve, dispatch, finish, find, submit } from './analytics-fixture.mjs'
import { configureModel, modelBindings } from './model-settings-fixture.mjs'
export { modelBindings }
export const topics = ['Liability', 'Payment', 'Insurance', 'Confidentiality', 'Audit', 'Termination', 'Renewal', 'Indemnity', 'Assignment']
export const preferred = topics.map(t => `${t}: the approved standard position applies for twelve months.`)
export const fallback = topics.map(t => `${t}: the negotiated position applies for twenty-four months.`)
export const scope = { agreementTypes: ['supplier'], entityIds: [] }

export async function draftingFixture(h) {
 const counsel = await h.invite('synthetic-locket-drafting-counsel@example.test', 'counsel')
 const source = await counsel.command('playbook.draft', { rules: topics.map((title, i) => ({ key: `topic${i}`, title, preferred: preferred[i], alternatives: [], authority: 'counsel' })) })
 await counsel.command('playbook.activate', { id: source.id })
 const templates = []
 const msa = await counsel.command('template.create', { name: 'Approved MSA', type: 'supplier', body: 'Approved MSA\n' + preferred.join('\n'), fields: [], clauses: [{ key: 'topic0', title: topics[0], ruleKey: 'topic0', variants: [{ id: 'standard', label: 'Standard', text: preferred[0] }] }] })
 await counsel.command('template.decide', { versionId: msa.versionId, decision: 'approve' })
 templates.push(msa)
 const word = await counsel.command('template.word.upload', { name: 'Approved supplier agreement', type: 'supplier', file: file('supplier.docx', docx(['Company', ...preferred])) })
 const marked = await counsel.command('template.word.mark', { versionId: word.versionId, revision: 1, marks: [{ kind: 'field', name: 'company', label: 'Company', start: 0, end: 7, quote: 'Company', required: true }] })
 await counsel.command('template.word.preview', { ...marked, fields: { company: 'Synthetic supplier' } })
 await counsel.command('template.decide', { versionId: word.versionId, decision: 'approve' })
 templates.push(word)
 const agreements = []
 for (let i = 0; i < 20; i++) {
  const contents = `Executed supplier ${i + 1}\n` + fallback.join('\n')
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica)
  doc.addPage([595, 842]).drawText(contents, { x: 40, y: 800, size: 10, font, maxWidth: 515, lineHeight: 14 })
  const a = await h.owner.command('request.create', { title: `Executed supplier ${i + 1}`, type: 'supplier', party: { name: `Synthetic supplier ${i + 1}`, kind: 'supplier' }, restricted: i === 0, file: file('supplier.pdf', Buffer.from(await doc.save())), text: contents })
  for (const r of (await h.owner.state()).requirements.filter(r => r.agreement_id === a.id)) await h.owner.command('requirement.attach', { agreementId: a.id, requirementId: r.id, file: file('attachment.pdf', pdf(r.label)) })
  if (i === 0) a.finding = await counsel.command('deviation.add', { agreementId: a.id, versionId: a.versionId, clauseKey: 'topic0', result: 'met', start: contents.indexOf(fallback[0]), end: contents.indexOf(fallback[0]) + fallback[0].length, quote: fallback[0], explanation: 'Historical reviewer judgment remains pinned to the earlier playbook.', questions: [] })
  if (i === 1 || i === 2) a.exception = await counsel.command('deviation.add', { agreementId: a.id, versionId: a.versionId, clauseKey: 'topic0', result: 'breached', start: contents.indexOf(fallback[0]), end: contents.indexOf(fallback[0]) + fallback[0].length, quote: fallback[0], explanation: 'Explicit negotiation exception; execution alone never records counterparty acceptance.', questions: [] })
  await submit(h.owner, a.id); a.approval = await approve(h.owner, a.id)
  if (a.exception) a.exceptionApproval = await counsel.command('approval.decide', { agreementId: a.id, version: (await find(counsel, a.id)).version, versionId: a.versionId, kind: 'exception', deviationId: a.exception.id, decision: 'approved', reason: 'Approve this exact exception; a counterparty outcome needs separately recorded evidence.' })
  a.package = await dispatch(h.owner, a.id)
  assert.equal((await finish(h.owner, a.id, a.package)).status, 'reconciled')
  agreements.push(a)
 }
 await configureModel(h)
 return { counsel, source, templates, agreements, payload: { templateVersionIds: templates.map(t => t.versionId), agreementIds: agreements.map(a => a.id), scope, simulated: true, consent: true } }
}
export function draftingFake(calls, mode = () => 'ok', during = async () => {}) {
 return async request => {
  const body = await request.json(), provider = new URL(request.url).hostname === 'api.anthropic.com' ? 'anthropic' : new URL(request.url).hostname === 'api.cloudflare.com' ? 'workers-ai' : 'openai'
  assert.equal(request.method, 'POST'); assert.equal(body.max_tokens, 12000)
  assert.equal(body.model, 'synthetic-locket-1')
  assert.equal(provider === 'anthropic' ? request.headers.get('x-api-key') : request.headers.get('authorization'), provider === 'anthropic' ? modelBindings.AI_API_KEY : `Bearer ${modelBindings.AI_API_KEY}`)
  const prompt = body.system ?? body.messages[0].content
  assert.match(prompt, /^locket-playbook-drafting-v1:/)
  const input = JSON.parse(body.messages.at(-1).content)
  calls.push({ provider, input, prompt })
  await during()
  if (mode() === 'reject') return new Response('Synthetic provider unavailable', { status: 503 })
  const templates = input.sources.filter(s => s.kind === 'template'), agreements = input.sources.filter(s => s.kind === 'agreement')
  const citation = (source, quote, position, alternativeIndex = null) => {
   const page = source.pages.find(p => p.text.includes(quote)), start = page.text.indexOf(quote)
   return { kind: source.kind, id: source.id, page: page.page, start, end: start + quote.length, quote, position, alternativeIndex }
  }
  const rules = topics.map((title, i) => ({ key: `topic${i}`, title, preferred: preferred[i], alternatives: [fallback[i]], authority: i % 2 ? 'approver' : 'counsel', guidance: 'Suggested authority only; counsel must decide. Negotiation outcomes, operational issues and cycle-time effects are unknown.', citations: [citation(templates[i % templates.length], preferred[i], 'preferred'), ...(agreements.length < topics.length ? [agreements[i % agreements.length]] : agreements.filter((_, j) => j % topics.length === i)).map(a => citation(a, fallback[i], 'fallback', 0))] }))
  if (mode() === 'quote') rules[0].citations[0].quote = 'This passage does not exist.'
  if (mode() === 'source') rules[0].citations[0].id = 'unselected-source'
  if (mode() === 'fallback') rules[0].alternatives[0] = 'Invented fallback with an unrelated valid quote.'
  const content = JSON.stringify({ rules })
  if (provider === 'anthropic') return Response.json({ content: [{ type: 'text', text: content }], usage: { input_tokens: 1000, output_tokens: 500 } })
  if (provider === 'workers-ai') return Response.json({ success: true, result: { response: content, usage: { prompt_tokens: 1000, completion_tokens: 500 } } })
  return Response.json({ choices: [{ message: { content } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } })
 }
}
export const draftRecord = async (f, id) => (await f.counsel.state()).playbookDrafting.drafts.find(d => d.id === id)
export async function reviewDraft(f, id) {
 const original = await draftRecord(f, id), rules = JSON.parse(original.proposals)
 for (let i = 0; i < rules.length; i++) {
  const d = await draftRecord(f, id)
  await f.counsel.command('playbook.generation.decide', { draftId: id, revision: d.revision, ruleKey: rules[i].proposed.key, decision: i < 6 ? 'accept' : i < 8 ? 'edit' : 'reject', reason: i < 6 ? 'Reviewed exact template and signed evidence.' : i < 8 ? 'Counsel revises the preferred position and exception authority.' : 'Counsel rejects this proposed position.', rule: { ...rules[i].proposed, preferred: `Counsel edited ${rules[i].proposed.preferred}`, authority: 'counsel' } })
 }
 return draftRecord(f, id)
}
