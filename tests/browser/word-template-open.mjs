// Run outside push Verify: real LibreOffice opens populated Word and exports
// its PDF, then the public product doors approve that exact PDF for signing.
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
import {extractText} from 'unpdf'
import {installation} from '../api/harness.mjs'
import {approvedWordFixture} from '../api/word-template-fixture.mjs'
import {file,pdf} from '../api/files.mjs'
const root=await mkdtemp(join(tmpdir(),'locket-word-open-')),h=await installation()
try{
 const f=await approvedWordFixture(h,{type:'supplier',pricing:true})
 const created=await h.owner.command('request.create',{title:'Supplier MSA format proof',type:'supplier',party:{name:'Ridgeway Services',kind:'supplier'},templateVersionId:f.versionId,fields:f.fields,clauseChoices:{processing:'include'},lineItems:f.lineItems})
 let state=await h.owner.state(),original=state.artifacts.find(a=>a.version_id===created.versionId&&a.role==='original')
 const docx=Buffer.from(await(await h.owner.request(`/api/locket/files/${original.id}`)).arrayBuffer()),path=join(root,'populated.docx')
 await writeFile(path,docx)
 execFileSync('unzip',['-t',path],{stdio:'pipe'})
 execFileSync('soffice',[`-env:UserInstallation=file://${join(root,'office-profile')}`,'--headless','--convert-to','pdf','--outdir',root,path],{timeout:90000,stdio:'pipe'})
 const rendered=await readFile(join(root,'populated.pdf')),text=(await extractText(new Uint8Array(rendered),{mergePages:true})).text
 for(const phrase of ['MASTER SERVICES AGREEMENT','North & South LLP','Ridgeway Services','February 2, 2027','Joint evaluation','Data processing requires written instructions.','Support','125.50','Training','400.50','Migration','900.00','1426.00','Firm legal department','Confidential template'])assert.ok(text.includes(phrase),phrase)
 for(const requirement of state.requirements.filter(r=>r.agreement_id===created.id))await h.owner.command('requirement.attach',{agreementId:created.id,requirementId:requirement.id,file:file('required.pdf',pdf(requirement.label))})
 const current=async()=>(await h.owner.state()).agreements.find(a=>a.id===created.id)
 await h.owner.command('version.rendition',{agreementId:created.id,version:(await current()).version,versionId:created.versionId,file:file('reviewed.pdf',rendered)})
 await h.owner.command('agreement.submit',{agreementId:created.id,version:(await current()).version})
 await h.owner.command('approval.decide',{agreementId:created.id,version:(await current()).version,versionId:created.versionId,kind:'commercial',decision:'approved'})
 const packet=await h.owner.command('package.prepare',{agreementId:created.id,version:(await current()).version,provider:'paper',recipients:[{name:'Recipient',email:'synthetic-locket-signer@example.test',action:'sign'}]})
 assert.deepEqual(Buffer.from(await(await h.owner.request(`/api/locket/files/${packet.pdfArtifactId}`)).arrayBuffer()),rendered)
 const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),id=`sx-locket-c24-word-open-${sha}`
 if(process.env.LOCKET_BROWSER_OUTPUT){const output=resolve(process.env.LOCKET_BROWSER_OUTPUT);if(output===process.cwd()||output.startsWith(process.cwd()+'/'))throw Error('Evidence stays outside checkout.');await mkdir(output,{recursive:true});await writeFile(join(output,'word-open-receipt.json'),JSON.stringify({id,head:sha,converter:execFileSync('soffice',['--version'],{encoding:'utf8'}).trim(),checks:['ZIP opens','fields and conditional clause','three price rows and total','headers and footers','reviewed PDF approved and packaged byte-identically']},null,2)+'\n')}
 console.log(`PASS ${id}: populated Word opened by LibreOffice; the actual exported PDF retained all named content and was approved/packaged byte-identically.`)
}finally{await h.close();await rm(root,{recursive:true,force:true})}
