// Companion to word-template-open.mjs: open actual review outputs through
// LibreOffice, including pending revisions and threaded Word comments.
import assert from 'node:assert/strict'
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { extractText } from 'unpdf'
import { installation } from '../api/harness.mjs'
import { uploadedWordReview } from '../api/word-review-fixture.mjs'
const h=await installation(),root=await mkdtemp(join(tmpdir(),'locket-review-open-'))
try{
 const x=await uploadedWordReview(h),state=await h.owner.state(),comment=state.comments.find(c=>c.version_id===x.uploaded.versionId&&c.body===x.commentBodies[0])
 await h.owner.command('comment.add',{agreementId:x.a.id,versionId:x.uploaded.versionId,parentId:comment.id,body:'Our reply: the payment period is agreed.'})
 const reviewed=await h.owner.command('word.review',{agreementId:x.a.id,version:x.a.version,versionId:x.uploaded.versionId,decisions:x.decisions})
 let a=(await h.owner.state()).agreements.find(a=>a.id===x.a.id)
 const edited=await h.owner.command('word.review',{agreementId:a.id,version:a.version,versionId:reviewed.versionId,edit:{start:0,end:1,replacement:'One'}})
 a=(await h.owner.state()).agreements.find(row=>row.id===x.a.id)
 for(const kind of ['redline','clean']){
  const output=await h.owner.command('word.output',{agreementId:x.a.id,version:a.version,versionId:edited.versionId,kind,confirmCleanup:true}),bytes=Buffer.from(await(await h.owner.request('/api/locket/files/'+output.artifactId)).arrayBuffer()),path=join(root,kind+'.docx')
  await writeFile(path,bytes);execFileSync('unzip',['-t',path],{stdio:'pipe'})
  const result=execFileSync('soffice',[`-env:UserInstallation=file://${join(root,'profile')}`,'--headless','--convert-to','pdf','--outdir',root,path],{timeout:90000,encoding:'utf8'})
  assert.ok(!/repair|corrupt|error/i.test(result),result)
  const rendered=await readFile(join(root,kind+'.pdf')),content=(await extractText(new Uint8Array(rendered),{mergePages:true})).text
  for(const phrase of ['Payment','30 days','$2,000,000','Maintain insurance.','Firm legal department','Confidential template','600.00'])assert.ok(content.includes(phrase),phrase+' '+content)
  console.log(`PASS ${kind}: LibreOffice opened and rendered format-preserving Word without repair.`)
 }
 console.log('PASS Word review opening at '+execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim())
}finally{await h.close();await rm(root,{recursive:true,force:true})}
