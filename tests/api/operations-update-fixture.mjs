// Only the Cloudflare network edge is substituted; queries use the real D1.
import { randomUUID } from 'node:crypto'
export function providerEdge(db) {
 const databaseId=randomUUID(),versionId=randomUUID(),deploymentId=randomUUID()
 const accountId='1'.repeat(32),worker='locket-production',name=worker+'-db'
 const provider={versionId,deploymentId,etag:'synthetic-locket-1'}
 let replaced=false,queries=0
 const state={version:1,kind:'rer-deploy-owner-state',accountId,project:'contracts/locket',environment:'production',worker,owned:{worker:{status:'created'},d1:{[name]:{status:'created',id:databaseId}},r2:{},kv:{},queues:{}},receipt:{provider,resources:{d1:[{binding:'DB',name,id:databaseId}]}}}
 const fetch=async (url,options={})=>{
  const path=new URL(url).pathname.split('/accounts/'+accountId)[1]
  let result
  if(path===`/workers/scripts/${worker}/settings`)result={bindings:[{name:'DB',id:databaseId}]}
  else if(path===`/workers/scripts/${worker}/deployments`)result={deployments:[{id:deploymentId,versions:[{percentage:100,version_id:versionId}]}]}
  else if(path===`/workers/scripts/${worker}/versions/${versionId}`)result={id:versionId,resources:{script:{etag:replaced?'synthetic-locket-2':provider.etag}}}
  else if(path===`/d1/database/${databaseId}`)result={uuid:databaseId,name}
  else if(path===`/d1/database/${databaseId}/query`){
   queries++
   const body=JSON.parse(options.body),statements=body.batch??[body]
   result=await db.batch(statements.map(({sql,params})=>db.prepare(sql).bind(...params)))
   // The REST edge represents SQLite blobs as byte arrays.
   result=JSON.parse(JSON.stringify(result,(_,value)=>value instanceof ArrayBuffer?[...new Uint8Array(value)]:value))
  }else throw Error('Unexpected provider request: '+path)
  return Response.json({success:true,result,errors:[],messages:[]})
 }
 return {accountId,state,fetch,get queries(){return queries},replace(){replaced=true}}
}
