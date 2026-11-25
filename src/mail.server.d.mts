import type { MailSender } from './modules/operator-auth/index.mjs'
import type { Bindings } from './auth.server'
export function mailIsOff(env: Bindings): boolean
export function mailUnavailableCode(env: Bindings): 'mail_off' | 'mail_unavailable'
export function operatorMail(env: Bindings, options?: { health?: boolean }): MailSender | undefined
