// Postmark's authenticated inbound network edge. Native capability scope and
// exact attachment bytes are still validated by the same guarded public writer.
import type { Bindings } from '../auth.server'
import { findExchangeToken, mutateExchange } from './exchange-public'
import { fail, list, object, optionalText, Problem, sha256, text } from './model'

const headers={'cache-control':'no-store','x-content-type-options':'nosniff'}
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers})
export function replyDomain(env:Bindings):string|null{
  const value=env.POSTMARK_REPLY_DOMAIN?.toLowerCase()
  if(!value||value.length>253||!value.includes('.')||!value.split('.').every(part=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)))return null
  return value
}
async function authenticated(request:Request,secret:string){
  const auth=request.headers.get('authorization')??''
  let supplied=''
  if(auth.startsWith('Bearer '))supplied=auth.slice(7)
  else if(auth.startsWith('Basic ')){
    try{const decoded=atob(auth.slice(6));if(decoded.startsWith('locket:'))supplied=decoded.slice(7)}catch{}
  }
  // Hash equal-length values, then compare every position without an early exit.
  const expected=await sha256(secret),actual=await sha256(supplied)
  let difference=0
  for(let i=0;i<expected.length;i++)difference|=expected.charCodeAt(i)^actual.charCodeAt(i)
  return difference===0
}
export async function inboundExchangeResponse(request:Request,env:Bindings):Promise<Response|null>{
  if(new URL(request.url).pathname!=='/api/locket/exchange/inbound')return null
  try{
    if(request.method!=='POST')fail('METHOD','Use POST for inbound email.',405)
    const domain=replyDomain(env)
    if(!env.POSTMARK_INBOUND_SECRET||!domain)fail('INBOUND_UNAVAILABLE','Inbound counterparty email is not configured.',503)
    if(!await authenticated(request,env.POSTMARK_INBOUND_SECRET))fail('AUTH','Inbound provider authentication failed.',401)
    if(!(request.headers.get('content-type')??'').includes('application/json'))fail('INVALID','Send JSON.',415)
    if(Number(request.headers.get('content-length')??0)>9*1024*1024)fail('FILE_SIZE','Inbound email is too large.',413)
    const input=object(await request.json()),recipient=text(input,'OriginalRecipient',400).toLowerCase()
    const match=recipient.match(/^locket\+([a-f0-9]{64})@(.+)$/)
    if(!match||match[2]!==domain)fail('RECIPIENT','The inbound address is not an exchange on this installation.',403)
    const row=await findExchangeToken(match[1],env)
    const fromFull=input.FromFull===undefined?null:object(input.FromFull,'FromFull')
    const from=text(input,'From',320).toLowerCase()
    if(from!==row.recipient_email.toLowerCase()||(fromFull&&text(fromFull,'Email',320).toLowerCase()!==from))fail('SENDER','Only the designated counterparty contact may reply.',403)
    const messageId=text(input,'MessageID',200)
    // MessageID is a provider-generated idempotency identity. It never grants
    // authority, and changing its content is refused by the native command log.
    const identity=await sha256('postmark-reply:'+row.id+':'+messageId)
    const commandId=`${identity.slice(0,8)}-${identity.slice(8,12)}-${identity.slice(12,16)}-${identity.slice(16,20)}-${identity.slice(20,32)}`
    const attachments=list(input,'Attachments',10).map(value=>{
      const attachment=object(value,'attachment')
      return {filename:text(attachment,'Name',255),mediaType:optionalText(attachment,'ContentType',200)??'',base64:text(attachment,'Content',8*1024*1024)}
    })
    const rawBody=optionalText(input,'StrippedTextReply',4000)??optionalText(input,'TextBody',4000)
    const body=rawBody?.replaceAll(match[1],'[exchange capability removed]').replace(/(\/exchange#|locket\+)[a-f0-9]{64}/gi,'$1[exchange capability removed]')??null
    // No HTML-to-text guesses or remote attachment fetches: exact provider bytes.
    return await mutateExchange(new Request(new URL('/api/locket/exchange/reply',env.AUTH_ORIGIN),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({commandId,payload:{body,files:attachments}})}),env,row,'reply')
  }catch(error){
    if(error instanceof Problem)return reply({ok:false,error:{code:error.code,message:error.message}},error.status)
    if(error instanceof SyntaxError)return reply({ok:false,error:{code:'INVALID',message:'Send a valid inbound JSON envelope.'}},400)
    return reply({ok:false,error:{code:'SERVER',message:'The inbound reply could not be recorded.'}},500)
  }
}
