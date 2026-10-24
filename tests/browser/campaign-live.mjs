// A fresh native Start installation; stop only the foreground process we own.
import { mkdtemp,mkdir,rm,writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join,resolve } from 'node:path'
import { tmpdir,userInfo } from 'node:os'
import { freshCopy,child,command,freePort,redact } from './runtime.mjs'
const workspace=process.cwd(),specs=process.argv.slice(2)
if(!specs.length)throw Error('Name the clause browser specs to run.')
const parent=await mkdtemp(join(tmpdir(),'locket-campaign-live-')),root=join(parent,'installation'),evidence=resolve(process.env.LOCKET_BROWSER_OUTPUT||join(tmpdir(),'locket-campaign-live-evidence')),screenshots=join(evidence,'screenshots')
if(evidence===workspace||evidence.startsWith(workspace+'/'))throw Error('Keep browser evidence outside the checkout.')
await mkdir(screenshots,{recursive:true})
let runtime,failure
try{
 await freshCopy(workspace,root)
 const port=await freePort()
 // The customer-site acceptance door needs the same ephemeral key in the
 // installation and its fixture website. Configure it through public setup.
 const clickwrapKey='synthetic-locket-'+randomUUID(),answers=join(root,'.acceptance-answers.json')
 await writeFile(answers,JSON.stringify({OWNER_EMAIL:'owner@example.test',CLICKWRAP_SIGNING_KEY:clickwrapKey}),{mode:0o600,flag:'wx'})
 try{await command(join(root,'node_modules/.bin/rer'),['setup','--answers',answers,'--non-interactive','--port',String(port),'--no-queue'],root)}finally{await rm(answers,{force:true})}
 runtime=child(join(root,'node_modules/.bin/rer'),['dev','--foreground','--json','--port',String(port),'--no-queue'],root)
 let ready
 const deadline=Date.now()+600000
 while(Date.now()<deadline){
  ready=runtime.output().split('\n').flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}}).find(event=>event.event==='ready'&&event.openUrl)
  if(ready)break
  if(runtime.process.exitCode!==null)throw Error(redact(runtime.output()).slice(-6000))
  await new Promise(resolve=>setTimeout(resolve,200))
 }
 if(!ready)throw Error('Owned native dev did not become ready in ten minutes.')
 console.log('Native product ready; private entry retained in memory.')
 console.log(redact(await command(join(workspace,'node_modules/.bin/playwright'),['test','--config',join(workspace,'tests/browser/playwright.config.ts'),...specs,'--workers=1'],workspace,{HOME:userInfo().homedir,LOCKET_CAMPAIGN_LIVE:process.env.LOCKET_CAMPAIGN_LIVE??'1',LOCKET_NOTICE_LIVE:'1',CLICKWRAP_SIGNING_KEY:clickwrapKey,LOCKET_BASE_URL:new URL(ready.url).origin,LOCKET_OPEN:ready.openUrl,LOCKET_SCREENSHOTS:screenshots,LOCKET_BROWSER_OUTPUT:evidence})))
 console.log('Native clause screens at 1440 and 390 passed: '+screenshots)
}catch(error){failure=error}finally{
 if(runtime?.process.exitCode===null){runtime.process.kill('SIGTERM');await Promise.race([runtime.done,new Promise(resolve=>setTimeout(resolve,20000))]);if(runtime.process.exitCode===null){runtime.process.kill('SIGKILL');await runtime.done}}
 await rm(parent,{recursive:true,force:true})
}
if(failure){console.error(redact(failure.message));process.exitCode=1}
