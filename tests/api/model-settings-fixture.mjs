import { library, file, pdf } from './setup.mjs'
export const modelQuote = 'Invoices are payable within 30 days. Either party must give 60 days notice.'
export const modelBindings = { LOCKET_MODEL_SIMULATION: 'true' }
export function modelFake(calls, mode = () => 'ok') {
 return async request => {
  const body = await request.json(); calls.push(body)
  if (mode() === 'reject') return new Response('Unavailable', { status: 503 })
  return Response.json({ choices: [{ message: { content: JSON.stringify({ proposals: [{ key: body.task === 'review' ? 'payment' : 'notice_days', value: body.task === 'review' ? 'met' : '60', quote: mode() === 'quote' ? 'Absent passage.' : modelQuote }] }) } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } })
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
