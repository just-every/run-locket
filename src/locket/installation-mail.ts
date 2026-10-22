import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'

export const installationMailLocal=(env:Bindings)=>env.AUTH_LOCAL==='true'||(env as Bindings&{RER_DEMO?:string}).RER_DEMO==='1'
export const installationMail=operatorMail
export function installationMailReady(env:Bindings) {
 if(installationMailLocal(env))return true
 return Boolean(env.MAIL_FROM&&env.MAIL_API_KEY&&['resend','sendgrid','cloudflare','postmark'].includes(env.MAIL_PROVIDER??'')&&(env.MAIL_PROVIDER!=='cloudflare'||env.MAIL_ACCOUNT_ID)&&installationMail(env))
}
