import { randomBytes } from 'node:crypto'
import { file, docx } from './files.mjs'

export const exchangeText='synthetic-locket-1 agreement\nInvoices are due within 30 days.\nBoth parties protect confidential information.'
export const counterpartyText=exchangeText.replace('30 days','45 days')
export const freshToken=()=>randomBytes(32).toString('hex')
export async function exchangeFixture(h,{channel='link',sender=h.owner}={}){
  const created=await sender.command('request.create',{title:'synthetic-locket-1',type:'nda',party:{name:'synthetic-locket-2',kind:'supplier',contacts:[{name:'synthetic-locket-3',email:'synthetic-locket-3@example.test'}]},file:file('synthetic-locket-1.docx',docx([exchangeText.replace('30 days','15 days')]))})
  let state=await sender.state(),a=state.agreements.find(a=>a.id===created.id)
  const source=docx(exchangeText.split('\n'),{internalComment:'synthetic-locket-26 embedded private legal comment',metadataAuthor:'synthetic-locket-27 private metadata author'})
  const version=await sender.command('version.upload',{agreementId:a.id,version:a.version,kind:'upload',label:'synthetic-locket-4',file:file('synthetic-locket-2.docx',source)})
  const internal=[]
  for(const body of ['synthetic-locket-5 private legal position','synthetic-locket-6 private approval note'])internal.push(await sender.command('comment.add',{agreementId:a.id,versionId:version.versionId,body}))
  const external=await sender.command('comment.add',{agreementId:a.id,versionId:version.versionId,body:'synthetic-locket-7 external question'})
  a=(await sender.state()).agreements.find(item=>item.id===created.id)
  await sender.command('comment.audience',{agreementId:a.id,version:a.version,commentId:external.commentId,audience:'external',confirmExternal:true})
  a=(await sender.state()).agreements.find(item=>item.id===created.id)
  await sender.command('version.audience',{agreementId:a.id,version:a.version,versionId:version.versionId,audience:'external',confirmExternal:true})
  a=(await sender.state()).agreements.find(item=>item.id===created.id)
  const token=freshToken(),payload={agreementId:a.id,version:a.version,versionId:version.versionId,recipientEmail:'synthetic-locket-3@example.test',contactConsent:'synthetic-locket-8 recorded authority to receive this negotiation',channel,token,expiresAt:Date.now()+3600_000,confirmCleanRendition:true}
  const sent=await sender.command('exchange.send',payload)
  const request=(action,body={})=>h.request('/api/locket/exchange/'+action,{method:'POST',headers:{authorization:'Bearer '+token},body})
  return {created,version,source,external,internal,a,token,payload,sent,request}
}
