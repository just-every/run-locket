// NEG-004: install and use the real rer dev product; stop only its owned foreground PID.
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir, userInfo } from 'node:os'
import { pathToFileURL } from 'node:url'
const workspace=process.cwd()
const {freshCopy,child,command,freePort,redact}=await import(pathToFileURL(join(workspace,'tests/browser/runtime.mjs')))
const parent=await mkdtemp(join(tmpdir(),'locket-browser-edits-live-')),root=join(parent,'installation')
const evidence=resolve(process.env.LOCKET_BROWSER_OUTPUT || join(tmpdir(),'locket-browser-edits-live-evidence'))
if(evidence===workspace || evidence.startsWith(workspace+'/'))throw Error('Browser evidence must be outside the product checkout.')
const screenshots=join(evidence,'screenshots')
await mkdir(screenshots,{recursive:true})
let runtime, failure
try {
 await freshCopy(workspace,root)
 const port=await freePort()
 runtime=child(join(root,'node_modules/.bin/rer'),['dev','--foreground','--json','--port',String(port),'--no-queue'],root)
 let ready
 const deadline=Date.now()+600000
 while(Date.now()<deadline){
  const events=runtime.output().split('\n').flatMap(line=>{try{return [JSON.parse(line)]}catch{return []}})
  ready=events.find(e=>e.event==='ready'&&e.openUrl)
  if(ready)break
  if(runtime.process.exitCode!==null)throw Error(redact(runtime.output()).slice(-6000))
  await new Promise(r=>setTimeout(r,200))
 }
 if(!ready)throw Error('Owned dev did not become ready in ten minutes.')
 console.log('Real rer dev ready; private entry retained only in memory.')
 // The runner may isolate installer HOME; the Node process launching Chromium uses the real OS account home.
 console.log(redact(await command(join(workspace,'node_modules/.bin/playwright'),['test','--config',join(workspace,'tests/browser/playwright.config.ts'),'browser-edits.spec.ts','--workers=1'],workspace,{HOME:userInfo().homedir,LOCKET_EDITS_LIVE:'1',LOCKET_BASE_URL:new URL(ready.url).origin,LOCKET_OPEN:ready.openUrl,LOCKET_SCREENSHOTS:screenshots,LOCKET_BROWSER_OUTPUT:evidence})))
 console.log('Real browser revision and thread screens at 1440 and 390 passed. Screenshots: '+screenshots)
}catch(error){failure=error}finally{
 if(runtime?.process.exitCode===null){runtime.process.kill('SIGTERM');await Promise.race([runtime.done,new Promise(r=>setTimeout(r,20000))]);if(runtime.process.exitCode===null){runtime.process.kill('SIGKILL');await runtime.done}}
 await rm(parent,{recursive:true,force:true})
}
if(failure){console.error(redact(failure.message));process.exitCode=1}
