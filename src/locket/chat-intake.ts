import type { Bindings } from '../auth.server'
import type { Ctx } from './commands'
import { fail, sha256, sql, type Sql } from './model'

interface ChatIntakeBindings { CHAT_SLACK_SIGNING_SECRET?:string }
const encoder=new TextEncoder()
/** A provider callback opens a native form; it never creates an agreement or a session. */
export async function chatIntakeResponse(request:Request,env:Bindings):Promise<Response|null>{
 if(new URL(request.url).pathname!=='/api/locket/chat-intake/slack')return null
 const headers={'cache-control':'no-store','x-content-type-options':'nosniff'}
 if(request.method!=='POST')return new Response('Method not allowed',{status:405,headers})
 const secret=(env as Bindings&ChatIntakeBindings).CHAT_SLACK_SIGNING_SECRET
 if(!secret)return new Response('Chat intake is not configured',{status:503,headers})
 const timestamp=request.headers.get('x-slack-request-timestamp')??'',signature=request.headers.get('x-slack-signature')??''
 if(!/^\d{10}$/.test(timestamp)||Math.abs(Date.now()-Number(timestamp)*1000)>300000||!/^v0=[a-f0-9]{64}$/.test(signature))return new Response('Invalid provider signature',{status:401,headers})
 if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return new Response('Expected form data',{status:415,headers})
 const reader=request.body?.getReader();if(!reader)return new Response('Missing body',{status:400,headers})
 const chunks:Uint8Array[]=[];let size=0
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();return new Response('Request too large',{status:413,headers})}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 let raw:string;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{return new Response('Invalid text encoding',{status:400,headers})}
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify'])
 const digest=Uint8Array.from(signature.slice(3).match(/../g)!,part=>parseInt(part,16))
 if(!await crypto.subtle.verify('HMAC',key,digest,encoder.encode(`v0:${timestamp}:${raw}`)))return new Response('Invalid provider signature',{status:401,headers})
 const params=new URLSearchParams(raw);let providerId:string,responseUrl:string|undefined
 if(params.has('payload')){
  let payload:any;try{payload=JSON.parse(params.get('payload')!)}catch{return new Response('Invalid payload',{status:400,headers})}
  if(payload.type!=='message_action'||payload.callback_id!=='locket_contract'||typeof payload.user?.id!=='string')return new Response('Unsupported shortcut',{status:400,headers})
  providerId=payload.user.id;responseUrl=payload.response_url
  if(typeof responseUrl!=='string')return new Response('Missing private response address',{status:400,headers})
  let target:URL;try{target=new URL(responseUrl)}catch{return new Response('Invalid response address',{status:400,headers})}
  if(target.protocol!=='https:'||target.hostname!=='hooks.slack.com'||target.port||target.username||target.password||!target.pathname.startsWith('/actions/')||target.hash)return new Response('Invalid response address',{status:400,headers})
 }else{
  if(params.get('command')!=='/contract')return new Response('Unsupported command',{status:400,headers})
  providerId=params.get('user_id')??''
 }
 const mapping=await env.DB.prepare("SELECT i.operator_id,i.version FROM lk_chat_identities i JOIN oa_operators o ON o.id=i.operator_id WHERE i.channel='slack' AND i.provider_id=? AND o.status='active'").bind(providerId).first<{operator_id:string;version:number}>()
 if(!mapping)return Response.json({response_type:'ephemeral',text:'Ask the Locket owner to map your Slack identity before opening a request.'},{headers})
 const token=crypto.randomUUID()+crypto.randomUUID(),hash=await sha256(token)
 const claimed=await env.DB.prepare('INSERT INTO lk_chat_intake_launches VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(callback_hash) DO NOTHING').bind(hash,await sha256(timestamp+':'+raw),mapping.operator_id,providerId,mapping.version,Date.now()+600000).run()
 if(!claimed.meta.changes)return Response.json({response_type:'ephemeral',text:'This command was already handled. Use its original link or run a new command.'},{headers})
 const url=new URL(env.AUTH_ORIGIN).origin+'/app#new/slack/'+token
 const message={response_type:'ephemeral',replace_original:false,text:`Sign in to Locket to complete your request: <${url}|Open request form>. This link expires in ten minutes and works only for your mapped account.`}
 if(responseUrl){
  // The signed callback authorizes one private reply; unknown outcomes are never retried.
  try{const sent=await fetch(responseUrl,{method:'POST',redirect:'manual',headers:{'content-type':'application/json'},body:JSON.stringify(message),signal:AbortSignal.timeout(2000)});if(!sent.ok)return new Response('Private reply was not accepted',{status:502,headers})}
  catch{return new Response('Private reply outcome unknown',{status:502,headers})}
  return new Response('',{headers})
 }
 return Response.json(message,{headers})
}
export async function chatLaunch(c:Ctx,p:Record<string,unknown>,agreementId:string):Promise<{checks:Sql[];writes:Sql[]}>{
 if(p.chatLaunch===undefined)return {checks:[],writes:[]}
 if(typeof p.chatLaunch!=='string'||p.chatLaunch.length>100)fail('INVALID','Open a current chat request link.')
 const hash=await sha256(p.chatLaunch)
 const check=sql(`EXISTS(SELECT 1 FROM lk_chat_intake_launches l JOIN lk_chat_identities i ON i.channel='slack' AND i.provider_id=l.provider_id
 WHERE l.token_hash=? AND l.operator_id=? AND l.expires_at>? AND l.agreement_id IS NULL AND i.operator_id=l.operator_id AND i.version=l.identity_version)`,hash,c.actor.id,c.now)
 if(!(await c.db.prepare(`SELECT ${check.sql} AS ok`).bind(...check.params).first<{ok:number}>())?.ok)fail('CHAT_LAUNCH','This chat link expired, was used, or belongs to another account. Open a new command or shortcut.',403)
 return {checks:[check],writes:[sql('UPDATE lk_chat_intake_launches SET agreement_id=? WHERE token_hash=?',agreementId,hash)]}
}
