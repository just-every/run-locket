import type { Ctx } from './commands'
import { fail, json } from './model'

/** Fixed provider destinations; credentials never travel through stored inputs. */
export async function requestModel(c: Ctx, s: { provider: string; model: string }, prompt: string, input: unknown, maxTokens = 4096): Promise<Response> {
 const messages = [{ role: 'system', content: prompt }, { role: 'user', content: json(input) }]
 if (!c.env.AI_API_KEY) fail('MODEL_UNAVAILABLE', 'Configure the owner API key in the installation secret store.', 409)
 const signal = AbortSignal.timeout(90000)
 if (s.provider === 'anthropic') return fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': c.env.AI_API_KEY, 'anthropic-version': '2023-06-01' }, body: json({ model: s.model, system: prompt, messages: [messages[1]], max_tokens: maxTokens }), signal })
 if (s.provider === 'workers-ai') {
  if (!c.env.AI_WORKERS_ACCOUNT_ID) fail('MODEL_UNAVAILABLE', 'Configure the Workers AI account in the installation secret store.', 409)
  return fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(c.env.AI_WORKERS_ACCOUNT_ID)}/ai/run/${s.model.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${c.env.AI_API_KEY}` }, body: json({ model: s.model, store: false, messages, max_tokens: maxTokens }), signal })
 }
 return fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${c.env.AI_API_KEY}` }, body: json({ model: s.model, store: false, messages, max_tokens: maxTokens }), signal })
}
