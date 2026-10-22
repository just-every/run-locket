import { encodeBase64, validateMessage } from './modules/mail/src/core/validation.mjs'
import { classifyHttpStatus, requestProvider, safeProviderMessageId } from './modules/mail/src/core/transport.mjs'

/** Product adapter for the installation's explicitly selected Postmark provider.
 * One submission only: callers retain claims and never retry uncertain outcomes. */
export function postmarkMail(apiKey) {
 return { async send(message) {
  validateMessage(message)
  if(typeof apiKey!=='string'||!apiKey||/[\s\x00-\x1f\x7f]/.test(apiKey))throw new Error('invalid_mail_configuration')
  if(['unsubscribe','customArgs','asmGroupId','subscriptionTracking','kind','expiresAt','messageKey'].some(key=>message[key]!==undefined))throw new Error('unsupported_mail_setting')
  const body={From:message.from,To:message.to.join(','),Subject:message.subject,TextBody:message.text,HtmlBody:message.html,MessageStream:'outbound',
   ...(message.cc?{Cc:message.cc.join(',')}:{}),...(message.bcc?{Bcc:message.bcc.join(',')}:{}),...(message.replyTo?{ReplyTo:message.replyTo}:{}),
   Headers:Object.entries(message.headers??{}).map(([Name,Value])=>({Name,Value})),
   ...(message.attachments?{Attachments:message.attachments.map(a=>({Name:a.filename,Content:encodeBase64(a.content),ContentType:a.contentType,...(a.contentId?{ContentID:`cid:${a.contentId}`}:{})}))}:{})}
  const result=(status,providerMessageId=null,code)=>({provider:'postmark',status,providerMessageId,...(code?{code}:{})})
  const response=await requestProvider('https://api.postmarkapp.com/email',{method:'POST',headers:{'content-type':'application/json',accept:'application/json','X-Postmark-Server-Token':apiKey},body:JSON.stringify(body)})
  if(!response)return result('uncertain',null,'provider_outcome_unknown')
  const status=classifyHttpStatus(response.status)
  if(status){if(response.body)void response.body.cancel().catch(()=>{});return result(status,null,status==='rate_limited'?'rate_limited':status==='rejected'?'provider_rejected':'provider_outcome_unknown')}
  let reader,timer
  try{
   reader=response.body?.getReader()
   if(!reader)return result('uncertain',null,'provider_receipt_missing')
   const expired=new Promise(resolve=>{timer=setTimeout(()=>resolve(null),15000)}),decoder=new TextDecoder('utf-8',{fatal:true})
   let raw='',size=0
   while(true){const chunk=await Promise.race([reader.read(),expired]);if(!chunk)return result('uncertain',null,'provider_outcome_unknown');if(chunk.done)break;size+=chunk.value.byteLength;if(size>65536)return result('uncertain',null,'provider_receipt_missing');raw+=decoder.decode(chunk.value,{stream:true})}
   const receipt=JSON.parse(raw+decoder.decode()),id=safeProviderMessageId(receipt?.MessageID)
   if(typeof receipt?.ErrorCode==='number'&&receipt.ErrorCode!==0)return result('rejected',null,'provider_rejected')
   if(receipt?.ErrorCode!==0||!id||id!==receipt.MessageID)return result('uncertain',null,'provider_receipt_missing')
   return result('accepted',id)
  }catch{return result('uncertain',null,'provider_outcome_unknown')}
  finally{clearTimeout(timer);if(reader)void reader.cancel().catch(()=>{})}
 }}
}
