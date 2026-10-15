import { demoEffect } from './modules/demo/index.mjs'
import { createMailSender } from './modules/mail/index.mjs'
import { createD1DevelopmentOutbox } from './modules/mail/src/development/index.mjs'

function realMail(env) {
 return env.MAIL_PROVIDER === 'development'
  ? env.AUTH_LOCAL === 'true' ? createMailSender({ provider: 'development', mode: 'development' }, { outbox: createD1DevelopmentOutbox({ db: env.DB }) }) : undefined
  : env.MAIL_PROVIDER ? createMailSender({ provider: env.MAIL_PROVIDER, mode: 'production', apiKey: env.MAIL_API_KEY, ...(env.MAIL_PROVIDER === 'cloudflare' ? { accountId: env.MAIL_ACCOUNT_ID } : {}) }) : undefined
}

// The SDK's development transport writes an outbox instead of using fetch.
// Base's effect helper silently succeeds in demos for every mail transport.
export function operatorMail(env) {
 if (!env.MAIL_PROVIDER) return undefined
 return { send: message => demoEffect(() => realMail(env)?.send(message), () => ({
  provider: env.MAIL_PROVIDER, status: 'accepted', providerMessageId: `demo-${message.deliveryId}`,
 })) }
}
