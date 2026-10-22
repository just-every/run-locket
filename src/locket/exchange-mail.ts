// Postmark is the network edge. A claimed or uncertain attempt is never resent.
import { auditSql, commit, type Ctx } from './commands'
import { fullReaders } from './access'
import { exchangeChecks, tokenDigest, type ExchangeRow } from './exchange'
import { replyDomain } from './exchange-inbound'
import { Problem, sql } from './model'

export async function exchangeReceipt(c: Pick<Ctx,'db'|'commandId'>) {
  const row=await c.db.prepare('SELECT id,status,provider,provider_message_id FROM lk_exchanges WHERE id=?').bind(c.commandId).first()
  return row
}
export async function dispatchExchange(c:Ctx,token:unknown){
  const row=await c.db.prepare('SELECT * FROM lk_exchanges WHERE id=?').bind(c.commandId).first<ExchangeRow>()
  if(!row||row.channel!=='email'||row.status!=='queued')return exchangeReceipt(c)
  if(await tokenDigest(token)!==row.token_hash)return null
  const attempt=crypto.randomUUID()
  const finish=async(status:string,provider:string|null,receipt:string|null)=>{
    const audit=auditSql(c,{action:`exchange.email.${status}`,agreementId:row.agreement_id,summary:status==='accepted'?'Postmark accepted the counterparty exchange email; mailbox delivery is unconfirmed.':status==='suppressed'?'Exchange email suppressed in local development or demo; no email was sent.':`Counterparty email outcome: ${status}.`})
    await c.db.batch([
      c.db.prepare("UPDATE lk_exchanges SET status=?,provider=?,provider_message_id=? WHERE id=? AND status='sending' AND attempt_id=?").bind(status,provider,receipt,row.id,attempt),
      c.db.prepare(`INSERT INTO lk_audit SELECT ${audit.params.map(()=>'?').join(',')} WHERE EXISTS(SELECT 1 FROM lk_exchanges WHERE id=? AND status=? AND attempt_id=?)`).bind(...audit.params,row.id,status,attempt),
    ])
    return exchangeReceipt(c)
  }
  try{
    await commit(c,fullReaders,[...exchangeChecks(row,Date.now()),sql("EXISTS(SELECT 1 FROM lk_exchanges WHERE id=? AND status='queued')",row.id)], [sql("UPDATE lk_exchanges SET status='sending',attempt_id=? WHERE id=?",attempt,row.id)])
  }catch(error){
    if(!(error instanceof Problem))throw error
    // A competing caller may already own the claim; never overwrite it.
    const cancelled=auditSql(c,{action:'exchange.email.cancelled',agreementId:row.agreement_id,summary:'Counterparty email request cancelled because sender authority or the exchange changed.'})
    await c.db.batch([
      c.db.prepare(`INSERT INTO lk_audit SELECT ${cancelled.params.map(()=>'?').join(',')} WHERE EXISTS(SELECT 1 FROM lk_exchanges WHERE id=? AND status='queued')`).bind(...cancelled.params,row.id),
      c.db.prepare("UPDATE lk_exchanges SET status='cancelled' WHERE id=? AND status='queued'").bind(row.id),
    ])
    return exchangeReceipt(c)
  }
  if(c.env.AUTH_LOCAL==='true'||(c.env as {RER_DEMO?:string}).RER_DEMO==='1')return finish('suppressed','development',null)
  if(!c.env.POSTMARK_SERVER_TOKEN||!c.env.MAIL_FROM)return finish('rejected',null,null)
  // Fragment capabilities are not sent in referrers or ordinary page requests.
  const link=`${new URL(c.env.AUTH_ORIGIN).origin}/exchange#${token}`
  try{
    const response=await fetch('https://api.postmarkapp.com/email',{method:'POST',headers:{'content-type':'application/json','accept':'application/json','X-Postmark-Server-Token':c.env.POSTMARK_SERVER_TOKEN},body:JSON.stringify({From:c.env.MAIL_FROM,To:row.recipient_email,Subject:'A document is ready for your review',...(replyDomain(c.env)&&c.env.POSTMARK_INBOUND_SECRET?{ReplyTo:`locket+${token}@${replyDomain(c.env)}`}:{ }),TextBody:`A document has been shared for your review. This link permits viewing, downloading, commenting and uploading a markup until ${new Date(row.expires_at).toISOString()}. Anyone holding the link can use it.\n\n${link}`,MessageStream:'outbound'})})
    const body=await response.json().catch(()=>null) as {MessageID?:string;ErrorCode?:number}|null
    if(!response.ok||body?.ErrorCode)return finish(response.status===429?'rate_limited':'rejected','postmark',null)
    return finish(body?.MessageID?'accepted':'uncertain','postmark',body?.MessageID??null)
  }catch{return finish('uncertain','postmark',null)}
}
