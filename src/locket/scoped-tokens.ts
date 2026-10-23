// Integration credentials delegate explicit native doors and never bypass access policy.
import type { Bindings } from '../auth.server'
import { authority, requireRole, roleSql } from './access'
import { commit, type Ctx, type Handler } from './commands'
import { fail, integer, json, sha256, sql, text, type Actor, type Role, type Sql } from './model'

const owners:Role[]=['owner']
export async function scopedSecret(c:Ctx){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(c.env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('locket-api:'+c.commandId+':'+c.actor.sessionId)))].map(n=>n.toString(16).padStart(2,'0')).join('')
}
interface TokenRow {id:string;operator_id:string;session_id:string;expires_at:number;revoked_at:number|null;commands:string;reads:string}
function scopes(p:Record<string,unknown>,key:string){
 const values=p[key]
 if(!Array.isArray(values)||values.length>100||values.some(v=>typeof v!=='string'||!v||v.length>100)||new Set(values).size!==values.length)fail('INVALID','Choose explicit, distinct '+key+' scopes.')
 return values as string[]
}
const create:Handler=async(c,p)=>{
 requireRole(c.actor,owners,'create integration tokens')
 if(c.request?.headers.get('authorization')?.startsWith('Bearer '))fail('FORBIDDEN','Create tokens through a signed-in owner session.',403)
 const commands=scopes(p,'commands'),reads=scopes(p,'reads')
 if(commands.some(v=>!/^[-a-z]+(?:\.[-a-z]+)+$/.test(v)||v.startsWith('token.'))||reads.some(v=>!['/state','/repository','/search','/portfolio','/audit','/export','/files','/compare','/reports','/families','/exchanges','/word-review','/analytics','/clickwrap/acceptances','/clause-library','/outcome-report'].includes(v)))fail('INVALID','Choose documented native command names and read doors.')
 if(!commands.length&&!reads.length)fail('INVALID','Choose at least one scope.')
 const label=text(p,'label',100),expiresAt=integer(p,'expiresAt',c.now+60000,c.now+30*86400000),secret=await scopedSecret(c)
 return {allowed:owners,result:{id:c.commandId,label,expiresAt,commands,reads},checks:[],writes:[sql('INSERT INTO lk_api_tokens VALUES(?,?,?,?,?,?,?,?,?,NULL)',c.commandId,await sha256(secret),label,c.actor.id,c.actor.sessionId,json(commands),json(reads),expiresAt,c.now)],audit:[{action:'token.created',summary:'Created explicitly scoped integration token '+c.commandId+'.'}]}
}
const revoke:Handler=async(c,p)=>{
 requireRole(c.actor,owners,'revoke integration tokens')
 const id=text(p,'id',100)
 if(!await c.db.prepare('SELECT id FROM lk_api_tokens WHERE id=?').bind(id).first())fail('NOT_FOUND','No such integration token.',404)
 return {allowed:owners,result:{id},writes:[sql('UPDATE lk_api_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE id=?',c.now,id)],audit:[{action:'token.revoked',summary:'Revoked integration token '+id+'.'}]}
}
export const scopedTokenHandlers:Record<string,Handler>={'token.create':create,'token.revoke':revoke}
async function lookup(env:Bindings,request:Request){
 const authorization=request.headers.get('authorization')
 if(!authorization?.startsWith('Bearer '))return null
 const secret=authorization.slice(7)
 if(!/^[a-f0-9]{64}$/.test(secret))fail('AUTH','Invalid integration token.',401)
 const row=await env.DB.prepare('SELECT * FROM lk_api_tokens WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?').bind(await sha256(secret),Date.now()).first<TokenRow>()
 if(!row)fail('AUTH','Integration token expired or was revoked.',401)
 return row
}
export function tokenCheck(row:TokenRow):Sql{
 return sql('EXISTS(SELECT 1 FROM lk_api_tokens WHERE id=? AND operator_id=? AND session_id=? AND revoked_at IS NULL AND expires_at>?)',row.id,row.operator_id,row.session_id,Date.now())
}
export async function integrationActor(env:Bindings,request:Request,path:string){
 const row=await lookup(env,request)
 if(!row)return null
 if(request.method==='POST'){
  if(path!=='/commands')fail('FORBIDDEN','This token cannot use that door.',403)
 }else{
  const door=path.startsWith('/files/')?'/files':path.startsWith('/reports/')?'/reports':path.startsWith('/families/')?'/families':path
  if(request.method!=='GET'||!JSON.parse(row.reads).includes(door))fail('FORBIDDEN','This token does not permit that read.',403)
 }
 const person=await env.DB.prepare(`SELECT o.display_name name,o.email,o.version,(${roleSql}) role FROM oa_operators o WHERE o.id=?`).bind(row.operator_id,row.operator_id).first<{name:string;email:string;version:number;role:Role}>()
 if(!person)fail('AUTH','The token creator is unavailable.',401)
 const actor:Actor={id:row.operator_id,name:person.name,email:person.email,operatorVersion:person.version,role:person.role,sessionId:row.session_id}
 const c:Ctx={env,db:env.DB,actor,now:Date.now(),commandId:crypto.randomUUID()}
 await commit(c,owners,[tokenCheck(row)],[])
 return actor
}
export async function integrationCommandChecks(c:Ctx,type:string){
 if(!c.request)return []
 const row=await lookup(c.env,c.request)
 if(!row)return []
 if(row.operator_id!==c.actor.id||!JSON.parse(row.commands).includes(type)||type.startsWith('token.'))fail('FORBIDDEN','This token does not permit that command.',403)
 return [tokenCheck(row),sql("EXISTS(SELECT 1 FROM lk_api_tokens,json_each(lk_api_tokens.commands) scope WHERE lk_api_tokens.id=? AND scope.value=?)",row.id,type)]
}
export async function scopedTokenResult(c:Ctx,result:unknown){
 requireRole(c.actor,owners,'read an integration token')
 if(c.request?.headers.get('authorization')?.startsWith('Bearer '))fail('FORBIDDEN','Use the owner session that created this token.',403)
 const row=await c.db.prepare('SELECT * FROM lk_api_tokens WHERE id=?').bind(c.commandId).first<TokenRow>()
 if(!row||row.operator_id!==c.actor.id||row.session_id!==c.actor.sessionId)fail('AUTH','Use the owner session that created this token.',403)
 await commit(c,owners,[tokenCheck(row)],[])
 return {...result as Record<string,unknown>,token:await scopedSecret(c)}
}
