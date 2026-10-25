import { createMailSender } from './modules/mail/index.mjs'
import { postmarkMail } from './postmark-mail.server.mjs'

export function operatorMail(env, { health = true } = {}) {
 if (env.RER_DEMO === '1' || env.AUTH_LOCAL === 'true') {
  return createMailSender({ provider: 'development', mode: 'development' })
 }
 if (!env.MAIL_PROVIDER || env.MAIL_PROVIDER === 'development') return undefined
 async function observe(success, reason) {
  if (!env.DB) return
  const { observeOperation } = await import('./locket/connection-observations')
  await observeOperation(env, 'mail', env.MAIL_FROM ?? 'Sender not configured', success, reason)
 }
 return {
  async send(message) {
   let result
   try { const sender = env.MAIL_PROVIDER === 'postmark' ? postmarkMail(env.MAIL_API_KEY) : createMailSender({ provider: env.MAIL_PROVIDER, mode: 'production', apiKey: env.MAIL_API_KEY, ...(env.MAIL_PROVIDER === 'rer' ? { relayUrl: env.MAIL_RELAY_URL } : {}), ...(env.MAIL_PROVIDER === 'cloudflare' ? { accountId: env.MAIL_ACCOUNT_ID } : {}) }); result = await sender.send(message) } catch (error) {
    if (health) await observe(false, 'mail_outcome_unknown')
    throw error
   }
   if (health) await observe(result.status === 'accepted', result.status === 'accepted' ? 'mail_send_succeeded' : 'mail_' + result.status)
   return result
  },
 }
}
