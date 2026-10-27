import assert from 'node:assert/strict'
import { library, file, pdf } from './setup.mjs'
export const modelQuote = 'Invoices are payable within 30 days. Either party must give 60 days notice.'
export const modelBindings = { LOCKET_MODEL_SIMULATION: 'true', AI_API_KEY: 'synthetic-locket-1', AI_WORKERS_ACCOUNT_ID: 'synthetic-locket-2' }
export function modelFake(calls, mode = () => 'ok') {
 return async request => {
  const body = await request.json(), url = new URL(request.url)
  const provider = url.hostname === 'api.anthropic.com' ? 'anthropic' : url.hostname === 'api.cloudflare.com' ? 'workers-ai' : 'openai'
  assert.equal(request.method, 'POST')
  assert.equal(request.headers.get('content-type'), 'application/json')
  assert.equal(body.model, 'synthetic-locket-1')
  assert.equal(body.max_tokens, 4096)
  let prompt
  if (provider === 'anthropic') {
   assert.equal(request.url, 'https://api.anthropic.com/v1/messages')
   assert.equal(request.headers.get('x-api-key'), modelBindings.AI_API_KEY)
   assert.equal(request.headers.get('anthropic-version'), '2023-06-01')
   assert.equal(request.headers.get('authorization'), null)
   assert.equal(body.messages.length, 1)
   prompt = body.system
  } else {
   assert.equal(request.url, provider === 'workers-ai' ? 'https://api.cloudflare.com/client/v4/accounts/synthetic-locket-2/ai/run/synthetic-locket-1' : 'https://api.openai.com/v1/chat/completions')
   assert.equal(request.headers.get('authorization'), `Bearer ${modelBindings.AI_API_KEY}`)
   assert.equal(body.store, false)
   assert.equal(body.messages.length, 2)
   assert.equal(body.messages[0].role, 'system')
   prompt = body.messages[0].content
  }
  assert.equal(body.messages.at(-1).role, 'user')
  const input = JSON.parse(body.messages.at(-1).content)
  assert.equal(input.text, modelQuote)
  assert.ok(input.rules.length > 0)
  const task = prompt.startsWith('locket-review-v1:') ? 'review' : 'extraction'
  assert.ok(prompt.startsWith(`locket-${task}-v1:`))
  calls.push({ ...body, provider, task, messages: [{ role: 'system', content: prompt }, ...body.messages.filter(m => m.role !== 'system')] })
  if (mode() === 'reject') return new Response('Unavailable', { status: 503 })
  const content = JSON.stringify({ proposals: [{ key: task === 'review' ? 'payment' : 'notice_days', value: task === 'review' ? 'met' : '60', quote: mode() === 'quote' ? 'Absent passage.' : modelQuote }] })
  if (provider === 'anthropic') return Response.json({ content: [{ type: 'text', text: content }], usage: { input_tokens: 1000, output_tokens: 500 } })
  if (provider === 'workers-ai') return Response.json({ success: true, result: { response: content, usage: { prompt_tokens: 1000, completion_tokens: 500 } } })
  return Response.json({ choices: [{ message: { content } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } })
 }
}
export async function modelFixture(h) {
 const lib = await library(h, { counsel: h.owner })
 const create = async (type, title) => h.owner.command('legacy.import', { title, type, party: { name: 'Synthetic counterparty', kind: 'supplier' }, sourceSystem: 'Shared drive', sourceId: `synthetic-locket-${type}`, signed: true, text: modelQuote, file: file('synthetic-locket.pdf', pdf(title + '\n' + modelQuote)) })
 const supplier = await create('supplier', 'Synthetic supplier agreement'), nda = await create('nda', 'Synthetic NDA')
 return { ...lib, supplier, nda }
}
export const modelConfiguration = { enabled: true, provider: 'openai', model: 'synthetic-locket-1', disabledTypes: [], ocrProvider: 'textract', noTrainingZeroRetention: true, inputUsdPerMillion: 2, outputUsdPerMillion: 10 }
export async function configureModel(h, changes = {}) {
 const current = (await h.owner.state()).models.settings
 return h.owner.command('model.configure', { ...modelConfiguration, ...(current.version ? current : { version: 0 }), ...changes })
}
