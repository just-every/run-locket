import type { Bindings } from '../auth.server'
import { requireRole } from './access'
import { guardSql, type Handler } from './commands'
import { bool, fail, integer, list, object, oneOf, Problem, sha256, sql, text, type Sql } from './model'

export type WorkforceBindings = Bindings & { WORKFORCE_SCIM_TOKEN?:string; WORKFORCE_SAML_ISSUER?:string; WORKFORCE_SAML_SSO_URL?:string; WORKFORCE_SAML_CERT?:string }
export async function workforceSettings(env:Bindings){
 return env.DB.prepare("SELECT s.* FROM lk_workforce_settings s JOIN oa_operators o ON o.id=s.approved_by WHERE s.id='installation' AND s.enabled=1 AND o.role='owner' AND o.status='active' AND o.version=s.owner_version").first<any>()
}
export const workforceFence=(s:any)=>sql("EXISTS(SELECT 1 FROM lk_workforce_settings s JOIN oa_operators o ON o.id=s.approved_by WHERE s.id='installation' AND s.enabled=1 AND s.version=? AND o.id=? AND o.role='owner' AND o.status='active' AND o.version=s.owner_version)",s.version,s.approved_by)
const configure:Handler=async(c,p)=>{
 requireRole(c.actor,['owner'],'authorize workforce provisioning')
 if(c.request?.headers.has('authorization'))fail('FORBIDDEN','Use a signed-in owner session.',403)
 const version=integer(p,'version',0),enabled=bool(p,'enabled')
 if(p.consent!==true)fail('CONSENT','Explicitly approve workforce account creation, mapped access and deactivation.')
 const prior=await c.db.prepare("SELECT * FROM lk_workforce_settings WHERE id='installation'").first<any>()
 const groups=list(p,'groups',50).map(value=>{const g=object(value);return {id:text(g,'id',100),name:text(g,'name',120),role:oneOf(g,'role',['counsel','approver','requester','viewer'] as const),kind:oneOf(g,'kind',['group','department'] as const)}})
 if(groups.some(g=>!/^[a-zA-Z0-9_-]+$/.test(g.id))||new Set(groups.map(g=>g.id)).size!==groups.length)fail('INVALID','Use distinct opaque group identities.')
 if(prior&&groups.length)fail('IMMUTABLE','Approved mappings are immutable. Omit groups when changing enablement.',409)
 if(!prior&&(!enabled||!groups.length))fail('INVALID','Approve at least one group mapping.')
 const writes:Sql[]=[sql("INSERT INTO lk_workforce_settings VALUES('installation',?,1,?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,version=lk_workforce_settings.version+1,approved_by=excluded.approved_by,owner_version=excluded.owner_version",Number(enabled),c.actor.id,c.actor.operatorVersion)]
 for(const g of groups){const audience=crypto.randomUUID();writes.push(sql('INSERT INTO lk_intake_audiences VALUES(?,?,?,1)',audience,g.name,g.kind),sql('INSERT INTO lk_workforce_groups VALUES(?,?,?,?)',g.id,g.name,g.role,audience))}
 // Disabling ends all managed sessions and links. Re-enabling never reactivates people.
 if(!enabled)writes.push(sql("UPDATE oa_operators SET status='inactive' WHERE role<>'owner' AND id IN (SELECT id FROM lk_workforce_users)"),sql('DELETE FROM lk_intake_members WHERE audience_id IN (SELECT audience_id FROM lk_workforce_groups)'),sql('DELETE FROM lk_workforce_members'),sql('UPDATE oa_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE operator_id IN (SELECT id FROM lk_workforce_users)',c.now))
 return {allowed:['owner'],result:{enabled,version:version+1},checks:[sql("COALESCE((SELECT version FROM lk_workforce_settings WHERE id='installation'),0)=?",version)],writes,audit:[{action:'workforce.configure',summary:enabled?'Owner explicitly approved scoped workforce provisioning and immutable group mappings.':'Owner disabled workforce provisioning and revoked managed access.'}]}
}
export const workforceHandlers:Record<string,Handler>={'workforce.configure':configure}
const schema='urn:ietf:params:scim:schemas:core:2.0:'
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'content-type':'application/scim+json','cache-control':'no-store','x-content-type-options':'nosniff'}})
async function commitProvision(env:Bindings,s:any,checks:Sql[],writes:Sql[],action:string){
 const guard=crypto.randomUUID(),audit=crypto.randomUUID()
 const all=[guardSql(guard,[workforceFence(s),...checks]),...writes,sql("INSERT INTO lk_audit VALUES(?,?,?,'Workforce provisioning','owner',?,NULL,'Owner-authorized workforce account or group change.',?)",audit,Date.now(),s.approved_by,action,audit),sql('DELETE FROM lk_guard WHERE id=?',guard)]
 try{await env.DB.batch(all.map(q=>env.DB.prepare(q.sql).bind(...q.params)))}catch(e){if(/LOCKET_GUARD|UNIQUE constraint/.test(String(e)))fail('SCIM_CONFLICT','Provisioning changed concurrently or this identity already exists.',409);throw e}
}
async function managed(env:Bindings,id:string){return env.DB.prepare("SELECT o.*,u.subject,u.version scim_version FROM lk_workforce_users u JOIN oa_operators o ON o.id=u.id WHERE u.id=? AND o.role<>'owner'").bind(id).first<any>()}
async function userResource(env:Bindings,u:any){
 const groups=(await env.DB.prepare('SELECT group_id value FROM lk_workforce_members WHERE operator_id=?').bind(u.id).all<any>()).results
 return {schemas:[schema+'User'],id:u.id,externalId:u.subject,userName:u.email,displayName:u.display_name,active:u.status==='active',groups,meta:{resourceType:'User',version:'W/"'+u.scim_version+'"'}}
}
async function groupResource(env:Bindings,g:any){return {schemas:[schema+'Group'],id:g.id,displayName:g.name,members:(await env.DB.prepare('SELECT operator_id value FROM lk_workforce_members WHERE group_id=?').bind(g.id).all<any>()).results}}
const userFence=(u:any)=>sql('EXISTS(SELECT 1 FROM lk_workforce_users WHERE id=? AND version=?)',u.id,u.scim_version)
const rolesAndSessions=(id:string,owner:string):Sql[]=>[
 sql("INSERT INTO lk_roles VALUES(?,COALESCE((SELECT CASE WHEN COUNT(DISTINCT g.role)=1 THEN MIN(g.role) ELSE 'viewer' END FROM lk_workforce_members m JOIN lk_workforce_groups g ON g.id=m.group_id WHERE m.operator_id=?),'viewer'),?,?) ON CONFLICT(operator_id) DO UPDATE SET role=excluded.role,updated_by=excluded.updated_by,updated_at=excluded.updated_at",id,id,owner,Date.now()),
 sql('UPDATE oa_operators SET version=version+1 WHERE id=?',id),sql('UPDATE oa_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE operator_id=?',Date.now(),id),sql('UPDATE oa_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE operator_id=?',Date.now(),id),sql('UPDATE lk_workforce_users SET version=version+1 WHERE id=?',id),
]
export async function workforceResponse(request:Request,env:Bindings):Promise<Response|null>{
 const url=new URL(request.url)
 if(!url.pathname.startsWith('/api/locket/scim/v2/'))return null
 try{
  const token=(env as WorkforceBindings).WORKFORCE_SCIM_TOKEN,authorization=request.headers.get('authorization')??''
  if(!token||token.length<32||await sha256(authorization)!==await sha256('Bearer '+token))fail('AUTH','Invalid provisioning credential.',401)
  if(url.origin!==env.AUTH_ORIGIN)fail('AUTH','Use the configured installation origin.',401)
  const s=await workforceSettings(env);if(!s)fail('FORBIDDEN','The owner has not enabled workforce provisioning.',403)
  const path=url.pathname.slice('/api/locket/scim/v2/'.length),[kind,id,...rest]=path.split('/')
  if(rest.length||!['Users','Groups'].includes(kind))fail('NOT_FOUND','No such provisioning resource.',404)
  if(request.method==='GET'){
   if(id){const row=kind==='Users'?await managed(env,id):await env.DB.prepare('SELECT * FROM lk_workforce_groups WHERE id=?').bind(id).first<any>();if(!row)fail('NOT_FOUND','No managed resource.',404);return reply(kind==='Users'?await userResource(env,row):await groupResource(env,row))}
   const filter=url.searchParams.get('filter'),match=filter?.match(/^(userName|externalId|displayName) eq "([^"\\]{1,254})"$/)
   if(filter&&!match)fail('INVALID','Unsupported SCIM filter.')
   const rows=kind==='Users'?(await env.DB.prepare('SELECT o.*,u.subject,u.version scim_version FROM lk_workforce_users u JOIN oa_operators o ON o.id=u.id ORDER BY u.id').all<any>()).results:(await env.DB.prepare('SELECT * FROM lk_workforce_groups ORDER BY id').all<any>()).results
   const filtered=rows.filter(r=>!match||(kind==='Users'?(match[1]==='userName'?r.email:match[1]==='externalId'?r.subject:r.display_name):match[1]==='displayName'?r.name:null)===match[2])
   const start=Number(url.searchParams.get('startIndex')??1),count=Number(url.searchParams.get('count')??100)
   if(!Number.isSafeInteger(start)||start<1||!Number.isSafeInteger(count)||count<0||count>100)fail('INVALID','Use a positive startIndex and count from zero to 100.')
   const Resources=await Promise.all(filtered.slice(start-1,start-1+count).map(r=>kind==='Users'?userResource(env,r):groupResource(env,r)))
   return reply({schemas:['urn:ietf:params:scim:api:messages:2.0:ListResponse'],totalResults:filtered.length,startIndex:start,itemsPerPage:Resources.length,Resources})
  }
  if(!['POST','PUT','PATCH'].includes(request.method))fail('METHOD','Deletion is not supported; deactivate explicitly.',405)
  if(!request.headers.get('content-type')?.match(/^application\/(?:scim\+)?json\b/))fail('INVALID','Send SCIM JSON.',415)
  const raw=await request.text();if(raw.length>65536)fail('INVALID','Provisioning request too large.',413)
  let p:Record<string,unknown>;try{p=object(JSON.parse(raw))}catch{fail('INVALID','Send a JSON object.')}
  if(kind==='Users'){
   if(request.method==='POST'){
    if(id)fail('METHOD','Create a user at the collection.',405)
    const subject=text(p,'externalId',255),email=text(p,'userName',254).toLowerCase(),name=text(p,'displayName',120),active=bool(p,'active'),uid=crypto.randomUUID()
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||p.groups!==undefined)fail('INVALID','Use an email userName; group membership is managed through Groups.')
    await commitProvision(env,s,[],[sql("INSERT INTO oa_operators(id,email,display_name,role,status,version,created_at) VALUES(?,?,?,'member',?,1,?)",uid,email,name,active?'active':'inactive',Date.now()),sql('INSERT INTO lk_workforce_users VALUES(?,?,1)',uid,subject),sql("INSERT INTO lk_roles VALUES(?,'viewer',?,?)",uid,s.approved_by,Date.now())],'workforce.user.create')
    return reply(await userResource(env,await managed(env,uid)),201)
   }
   const u=await managed(env,id);if(!u)fail('NOT_FOUND','No managed user.',404)
   if(request.headers.has('if-match')&&request.headers.get('if-match')!=='W/"'+u.scim_version+'"')fail('STALE','Resource version changed.',412)
   let name=u.display_name,active=u.status==='active'
   if(request.method==='PATCH'){
    for(const value of list(p,'Operations',20)){const op=object(value);if(!['replace','add'].includes(String(op.op).toLowerCase()))fail('INVALID','Only active and displayName replacement are supported.');const values=op.path===undefined?object(op.value):{[text(op,'path',50)]:op.value};for(const [key,val]of Object.entries(values)){if(key==='active'&&typeof val==='boolean')active=val;else if(key==='displayName'&&typeof val==='string')name=text({name:val},'name',120);else fail('INVALID','Only active and displayName may change. Stable identities cannot be reassigned.')}}
   }else{if(p.externalId!==u.subject||String(p.userName).toLowerCase()!==u.email||p.groups!==undefined)fail('INVALID','Stable identities cannot be reassigned.');name=text(p,'displayName',120);active=bool(p,'active')}
   const writes=[sql('UPDATE oa_operators SET display_name=?,status=? WHERE id=?',name,active?'active':'inactive',id),...rolesAndSessions(id,s.approved_by)]
   if(!active)writes.unshift(sql('DELETE FROM lk_intake_members WHERE operator_id=? AND audience_id IN (SELECT audience_id FROM lk_workforce_groups)',id),sql('DELETE FROM lk_workforce_members WHERE operator_id=?',id))
   await commitProvision(env,s,[userFence(u)],writes,'workforce.user.update');return reply(await userResource(env,await managed(env,id)))
  }
  const g=await env.DB.prepare('SELECT * FROM lk_workforce_groups WHERE id=?').bind(id??'').first<any>();if(!g)fail('NOT_FOUND','The owner must approve this group mapping first.',404)
  const members=new Set<string>((await env.DB.prepare('SELECT operator_id FROM lk_workforce_members WHERE group_id=?').bind(id).all<any>()).results.map(m=>m.operator_id)),before=[...members]
  const values=(value:unknown)=>{if(!Array.isArray(value)||value.length>1000)fail('INVALID','Send a bounded members list.');return value.map(v=>text(object(v),'value',100))}
  if(request.method==='PUT'){if(p.displayName!==g.name)fail('INVALID','The owner controls group names.');members.clear();for(const member of values(p.members))members.add(member)}
  else if(request.method==='PATCH')for(const value of list(p,'Operations',20)){
   const op=object(value),action=String(op.op).toLowerCase(),memberPath=typeof op.path==='string'?op.path.match(/^members\[value eq "([^"\\]{1,100})"\]$/):null
   if(action==='remove'&&memberPath){members.delete(memberPath[1]);continue}
   if(op.path!=='members'||!['add','replace','remove'].includes(action))fail('INVALID','Only mapped group membership may change.')
   if(action==='replace'||action==='remove'&&op.value===undefined)members.clear()
   if(op.value!==undefined)for(const member of values(op.value)){if(action==='remove')members.delete(member);else members.add(member)}
  }else fail('METHOD','The owner creates group mappings.',405)
  if(members.size>1000)fail('INVALID','Use groups with at most 1000 members.')
  const touched=[...new Set([...before,...members])],users=await Promise.all(touched.map(uid=>managed(env,uid)))
  if(users.some(u=>!u||members.has(u.id)&&u.status!=='active'))fail('INVALID','Choose only active managed users.')
  const checks=[sql('(SELECT group_concat(operator_id) FROM (SELECT operator_id FROM lk_workforce_members WHERE group_id=? ORDER BY operator_id)) IS ?',id,[...before].sort().join(',')||null),...users.map(userFence)]
  const writes=[sql('DELETE FROM lk_workforce_members WHERE group_id=?',id),sql('DELETE FROM lk_intake_members WHERE audience_id=?',g.audience_id)]
  for(const uid of members)writes.push(sql('INSERT INTO lk_workforce_members VALUES(?,?)',id,uid),sql('INSERT INTO lk_intake_members VALUES(?,?)',g.audience_id,uid))
  for(const uid of touched)writes.push(...rolesAndSessions(uid,s.approved_by))
  await commitProvision(env,s,checks,writes,'workforce.group.update');return reply(await groupResource(env,g))
 }catch(e){if(e instanceof Problem)return reply({schemas:['urn:ietf:params:scim:api:messages:2.0:Error'],status:String(e.status),detail:e.message},e.status);throw e}
}
