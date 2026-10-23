// No Base account is fabricated for a counterparty. The scoped bearer grant is
// independently rechecked, with its idempotent writes and audit in one batch.
import type { Bindings } from '../auth.server'
import { fileInput, isDocx, isPdf, DOCX, PDF, readArtifactBytes, storeArtifact } from './artifacts'
import { auditSql, guardSql, type Ctx, type AuditEntry } from './commands'
import { importWordReview } from './word-review-records'
import { exchangeChecks, externalComments, tokenDigest, type ExchangeRow } from './exchange'
import { canonical, fail, json, list, object, optionalText, Problem, sha256, sql, text, type Sql } from './model'
import { bump, invalidateApprovals, requireStatus, statusAfterChange, versionDigest, type AgreementRow } from './records'
import { workflowWrites } from './workflow-history'

const headers={'cache-control':'no-store, private','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY','content-security-policy':"frame-ancestors 'none'"}
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers})
function publicContext(env:Bindings,row:ExchangeRow,commandId:string=crypto.randomUUID()):Ctx {
  return {env,db:env.DB,now:Date.now(),commandId,actor:{id:'exchange:'+row.id,name:'Counterparty contact',email:'',role:'viewer',sessionId:'',operatorVersion:0}}
}
async function commitPublic(c:Ctx,row:ExchangeRow,checks:Sql[],writes:Sql[],audit:AuditEntry[],principalRole='counterparty_link'){
  const guard=crypto.randomUUID()
  try{
    const statements=[guardSql(guard,[...exchangeChecks(row,Date.now()),...checks]),...writes,...audit.map(entry=>auditSql(c,entry,principalRole)),sql('DELETE FROM lk_guard WHERE id=?',guard)]
    await c.db.batch(statements.map(s=>c.db.prepare(s.sql).bind(...s.params)))
  }catch(error){
    if(String(error).includes('LOCKET_GUARD')||String(error).includes('CHECK constraint'))fail('EXCHANGE_UNAVAILABLE','This exchange is unavailable, has changed or has expired.',404)
    throw error
  }
}
export async function findExchangeToken(token:unknown,env:Bindings){
  const hash=await tokenDigest(token)
  const row=await env.DB.prepare('SELECT * FROM lk_exchanges WHERE token_hash=?').bind(hash).first<ExchangeRow>()
  if(!row)fail('EXCHANGE_UNAVAILABLE','This exchange is unavailable or has expired.',404)
  const checks=exchangeChecks(row,Date.now())
  const ok=await env.DB.prepare(`SELECT CASE WHEN ${checks.map(s=>`(${s.sql})`).join(' AND ')} THEN 1 ELSE 0 END AS ok`).bind(...checks.flatMap(s=>s.params)).first<{ok:number}>()
  if(!ok?.ok)fail('EXCHANGE_UNAVAILABLE','This exchange is unavailable or has expired.',404)
  return row
}
async function open(request:Request,env:Bindings,row:ExchangeRow,download:boolean){
  const c=publicContext(env,row)
  if(download){
    const artifact=await env.DB.prepare('SELECT filename,media_type,sha256 FROM lk_artifacts WHERE id=? AND agreement_id=? AND version_id=?').bind(row.artifact_id,row.agreement_id,row.version_id).first<{filename:string;media_type:string;sha256:string}>()
    if(!artifact)fail('EXCHANGE_UNAVAILABLE','This external rendition is unavailable.',404)
    const bytes=await readArtifactBytes(env.DB,row.artifact_id)
    await commitPublic(c,row,[],[],[{action:'exchange.downloaded',agreementId:row.agreement_id,summary:`Counterparty downloaded the external rendition ${row.artifact_id}; SHA-256 ${artifact.sha256}.`}])
    return new Response(bytes as BodyInit,{headers:{...headers,'content-type':artifact.media_type,'content-disposition':`attachment; filename="${artifact.filename}"`,'x-content-sha256':artifact.sha256}})
  }
  const version=await env.DB.prepare('SELECT number,text,digest FROM lk_versions WHERE id=?').bind(row.version_id).first<{number:number;text:string;digest:string}>()
  if(!version)fail('EXCHANGE_UNAVAILABLE','This version is unavailable.',404)
  const comments=await externalComments(env.DB,row.version_id)
  await commitPublic(c,row,[sql("(SELECT json_group_array(json_object('id',c.id,'body',c.body,'quote',c.quote)) FROM (SELECT c.id,c.body,c.quote FROM lk_comments c JOIN lk_comment_audiences s ON s.comment_id=c.id WHERE c.version_id=? AND s.audience='external' ORDER BY c.at,c.id) c)=?",row.version_id,json(comments))],[sql('UPDATE lk_exchanges SET opened_at=COALESCE(opened_at,?) WHERE id=?',c.now,row.id)],[{action:'exchange.opened',agreementId:row.agreement_id,summary:`Counterparty opened external version ${version.number}.`}])
  return reply({version:{number:version.number,text:version.text,digest:version.digest},comments,expiresAt:row.expires_at})
}
export async function mutateExchange(request:Request,env:Bindings,row:ExchangeRow,action:'comment'|'upload'|'reply'){
  const body=object(await request.json()),commandId=text(body,'commandId',100),payload=object(body.payload)
  if(!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(commandId))fail('INVALID','commandId must be a UUID.')
  const digest=await sha256(canonical({action,payload})),c=publicContext(env,row,commandId)
  const prior=await env.DB.prepare('SELECT exchange_id,digest,result FROM lk_exchange_commands WHERE id=?').bind(commandId).first<{exchange_id:string;digest:string;result:string}>()
  const replay=(saved:typeof prior)=>{
    if(saved!.exchange_id!==row.id||saved!.digest!==digest)fail('IDEMPOTENCY','This command identity was already used for different content.',409)
    return reply({ok:true,result:JSON.parse(saved!.result)})
  }
  if(prior)return replay(prior)
  const checks:Sql[]=[],writes:Sql[]=[],audit:AuditEntry[]=[]
  let result:Record<string,unknown>
  const addComment=(body:string,quote:string|null)=>{
    const id=crypto.randomUUID()
    writes.push(sql('INSERT INTO lk_comments(id,agreement_id,version_id,author_id,body,quote,at,external_author_name,external_author_email) VALUES(?,?,?,?,?,?,?,?,?)',id,row.agreement_id,row.version_id,'exchange:'+row.id,body,quote,c.now,row.recipient_name,row.recipient_email),sql("INSERT INTO lk_comment_audiences VALUES(?,'external',1,?,?)",id,'exchange:'+row.id,c.now))
    audit.push({action:'exchange.commented',agreementId:row.agreement_id,summary:'Counterparty added an external comment to the shared version.'})
    return id
  }
  if(action==='comment'){
    const body=text(payload,'body',4000),quote=optionalText(payload,'quote',2000)
    if(quote){
      const v=await env.DB.prepare('SELECT text FROM lk_versions WHERE id=?').bind(row.version_id).first<{text:string}>()
      if(!v?.text.includes(quote))fail('CITATION','The quotation must appear in the shared version.')
    }
    result={commentId:addComment(body,quote)}
  }else{
    const replyBody=action==='reply'?optionalText(payload,'body',4000):null
    const files=action==='reply'?list(payload,'files',10):[payload.file]
    if(!files.length&&!replyBody)fail('INVALID','A reply must contain a comment or a PDF/DOCX attachment.')
    const commentId=replyBody?addComment(replyBody,null):null
    const versions:{versionId:string;number:number;digest:string;artifactDigest:string}[]=[]
    if(files.length){
      const a=await env.DB.prepare('SELECT * FROM lk_agreements WHERE id=?').bind(row.agreement_id).first<AgreementRow>()
      if(!a)fail('EXCHANGE_UNAVAILABLE','This exchange is unavailable.',404)
      requireStatus(a,['draft','in_review','approved','imported'],'receive a counterparty markup')
      if(a.current_version_id!==row.version_id)fail('NOT_CURRENT','A newer document has arrived. Ask the sender for a fresh exchange link.',409)
      const latest=await env.DB.prepare('SELECT MAX(number) AS n FROM lk_versions WHERE agreement_id=?').bind(a.id).first<{n:number}>()
      checks.push(sql('(SELECT version FROM lk_agreements WHERE id=?)=?',a.id,a.version),sql('(SELECT current_version_id FROM lk_agreements WHERE id=?)=?',a.id,row.version_id))
      let totalBytes=0
      for(const input of files){
        const file=fileInput(input)
        totalBytes+=file.bytes.length
        if(totalBytes>6*1024*1024)fail('FILE_SIZE','Reply attachments must total at most 6 MB.',413)
        if(!isDocx(file)&&!isPdf(file))fail('FILE_TYPE','Upload PDF or DOCX markups only.',415)
        file.mediaType=isDocx(file)?DOCX:PDF
        const versionId=crypto.randomUUID(),number=(latest?.n??0)+versions.length+1,source=isDocx(file)?'docx':'none'
        const word=isDocx(file)?await importWordReview(c,a.id,versionId,file.bytes,row.version_id):null,content=word?.text??null,fields=word?.fields??null
        const artifact=await storeArtifact(file,{agreementId:a.id,versionId,role:'original',provenance:{exchangeId:row.id,counterpartyMarkup:true,sharedVersionId:row.version_id,receivedBy:action==='reply'?'postmark_reply':'secure_link'},actorId:c.actor.id,at:c.now})
        const versionHash=await versionDigest({agreementId:a.id,number,files:[{role:'original',sha256:artifact.sha256}],text:content,fields})
        writes.push(...artifact.writes,sql('INSERT INTO lk_versions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',versionId,a.id,number,'counterparty','Counterparty markup',null,fields?json(fields):null,content,source,versionHash,c.actor.id,c.now),...(word?.writes??[]),sql("INSERT INTO lk_version_audiences VALUES(?,'external',1,?,?)",versionId,c.actor.id,c.now))
        versions.push({versionId,number,digest:versionHash,artifactDigest:artifact.sha256})
        audit.push({action:'exchange.uploaded',agreementId:a.id,summary:`Counterparty uploaded version ${number} through ${action==='reply'?'a provider-authenticated reply (sender identity not verified)':'the secure link'}; original artifact ${artifact.id}; SHA-256 ${artifact.sha256}.`})
      }
      const last=versions.at(-1)!
      writes.push(bump(c,a,'current_version_id=?,status=?',last.versionId,a.status==='imported'?'draft':statusAfterChange(a)),invalidateApprovals(c,a.id,'Counterparty returned a new document version'))
      audit.push({action:'version.add',agreementId:a.id,summary:`Received ${versions.length} counterparty markup version(s); earlier approvals no longer count.`})
      writes.push(...await workflowWrites(c,audit))
    }
    if(action==='reply')audit.push({action:'exchange.replied',agreementId:row.agreement_id,summary:`Provider-authenticated reply to the scoped address from the designated contact’s address; sender identity not verified. Recorded ${versions.length} original attachment(s).`})
    result=action==='reply'?{commentId,versions}:versions[0]
  }
  writes.push(sql('INSERT INTO lk_exchange_commands VALUES(?,?,?,?,?)',commandId,row.id,digest,json(result),c.now))
  try{await commitPublic(c,row,checks,writes,audit,action==='reply'?'counterparty_email':'counterparty_link')}catch(error){
    if(String(error).includes('UNIQUE constraint failed')){
      const won=await env.DB.prepare('SELECT exchange_id,digest,result FROM lk_exchange_commands WHERE id=?').bind(commandId).first<typeof prior>()
      if(won)return replay(won)
    }
    throw error
  }
  return reply({ok:true,result})
}
export async function publicExchangeResponse(request:Request,env:Bindings):Promise<Response|null>{
  const path=new URL(request.url).pathname
  if(!path.startsWith('/api/locket/exchange/'))return null
  try{
    if(request.method!=='POST')fail('METHOD','Use POST for scoped exchange access.',405)
    if(request.headers.get('origin')!==new URL(env.AUTH_ORIGIN).origin)fail('ORIGIN','Use the exchange link from this installation.',403)
    if(!(request.headers.get('content-type')??'').includes('application/json'))fail('INVALID','Send JSON.',415)
    if(Number(request.headers.get('content-length')??0)>8*1024*1024)fail('FILE_SIZE','The exchange request is too large.',413)
    const action=path.slice('/api/locket/exchange/'.length)
    if(!['open','download','comment','upload'].includes(action))fail('NOT_FOUND','No exchange action has that identity.',404)
    const bearer=request.headers.get('authorization')??''
    const row=await findExchangeToken(bearer.startsWith('Bearer ')?bearer.slice(7):null,env)
    return action==='open'||action==='download'?await open(request,env,row,action==='download'):await mutateExchange(request,env,row,action as 'comment'|'upload')
  }catch(error){
    if(error instanceof Problem)return reply({ok:false,error:{code:error.code,message:error.message}},error.status)
    // Malformed input must not expose SQL, provider responses or bearer values.
    if(error instanceof SyntaxError)return reply({ok:false,error:{code:'INVALID',message:'Send a valid JSON request.'}},400)
    return reply({ok:false,error:{code:'SERVER',message:'The exchange could not complete this request.'}},500)
  }
}
