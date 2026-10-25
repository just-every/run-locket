import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { checkReleaseHistory } from '../../scripts/release-history.mjs'
import { checkQuestionnaire } from '../../scripts/security-questionnaire.mjs'

test('Release history refuses missing releases, every oversized cadence gap and security fixes without timely merged provenance',()=>{
 const day=86400000,at=Date.parse('2026-10-01T00:00:00Z'),release={tag_name:'v0.1.0',published_at:new Date(at).toISOString()},base={releases:[release],advisories:[],fixes:[],now:at+31*day}
 assert.deepEqual(checkReleaseHistory(base),[])
 assert.ok(checkReleaseHistory({...base,now:at+31*day+1}).length)
 assert.ok(checkReleaseHistory({...base,releases:[]}).length)
 const advisory={ghsa_id:'synthetic-locket-1',state:'published',vulnerabilities:[{first_patched_version:{identifier:'0.1.0'}}]}
 const proof={...base,advisories:[advisory],fixes:[{ghsa:advisory.ghsa_id,fixedRelease:'v0.1.0',mergedAt:new Date(at-7*day).toISOString()}]}
 assert.deepEqual(checkReleaseHistory(proof),[])
 assert.ok(checkReleaseHistory({...proof,fixes:[]}).length)
 assert.ok(checkReleaseHistory({...proof,fixes:[{...proof.fixes[0],mergedAt:new Date(at-7*day-1).toISOString()}]}).length)
 assert.ok(checkReleaseHistory({...base,releases:[release,{...release,tag_name:'v0.2.0',published_at:new Date(at+32*day).toISOString()}],now:at+32*day}).length)
})
test('Security response coverage fails when a declared build connector is absent or a required domain is unanswered',async()=>{
 const deploy=JSON.parse(await readFile('deploy.json','utf8')),answers=JSON.parse(await readFile('security/questionnaire.json','utf8'))
 assert.deepEqual(checkQuestionnaire(deploy,answers),[])
 assert.ok(checkQuestionnaire({...deploy,secrets:[...deploy.secrets,{binding:'SYNTHETIC_NEW_CONNECTOR'}]},answers).length)
 assert.ok(checkQuestionnaire(deploy,{...answers,answers:{...answers.answers,backup:''}}).length)
})

test('Hosted export keeps records and file bytes in a verified restorable archive and refuses a replaced deployment', async()=>{
 const [{installation},{file,pdf},{providerEdge},{runCommand},{resolveProject},{parse},{mkdtemp,mkdir,writeFile,rm,cp,symlink},{tmpdir},{join},{archiveInventory,compareArchives},{fileRecords}]=await Promise.all([
  import('./harness.mjs'),import('./files.mjs'),import('./operations-update-fixture.mjs'),
  import('@runeditrun/rer/internal/cli/lifecycle.mjs'),import('@runeditrun/rer/internal/cli/project.mjs'),import('@runeditrun/rer/internal/cli/parse.mjs'),
  import('node:fs/promises'),import('node:os'),import('node:path'),import('../../scripts/installer/archive-inventory.mjs'),import('@runeditrun/rer/modules/portability/files'),
 ])
 const h=await installation(),directory=await mkdtemp(join(tmpdir(),'locket-operations-')),savedFetch=globalThis.fetch,savedEnv={...process.env}
 try{
  await h.owner.command('request.create',{title:'Renewal services',type:'supplier',party:{name:'Fieldstone Services',kind:'supplier'},file:file('terms.pdf',pdf('Services for Fieldstone through 2028.'))})
  await cp(process.cwd(),directory,{recursive:true,filter:path=>{const rel=path.slice(process.cwd().length+1);return !['.git','node_modules','.rer','.seed','.wrangler','dist','.tanstack','.cache'].includes(rel.split('/')[0])&&!rel.startsWith('.dev.vars')&&!rel.startsWith('.env')}})
  await symlink(join(process.cwd(),'node_modules'),join(directory,'node_modules'),'dir')
  await h.owner.command('calendar.connect',{provider:'google',calendarId:'synthetic-locket-1',accessToken:'synthetic-locket-2',scope:'all_accessible',consent:true})
  const edge=providerEdge(h.db)
  globalThis.fetch=edge.fetch
  Object.assign(process.env,{CI:'true',CLOUDFLARE_ACCOUNT_ID:edge.accountId,CLOUDFLARE_API_TOKEN:'synthetic-locket-1'})
  await mkdir(join(directory,'.rer/deploy'),{recursive:true})
  await writeFile(join(directory,'.rer/deploy/production.json'),JSON.stringify(edge.state))
  const project=await resolveProject(directory)
  const out={progress(){},event(){},human(){}}
  const before=join(directory,'exports/before.rer'),after=join(directory,'exports/after.rer')
  await runCommand(project,parse(['export','--target','remote','--output',before,'--no-queue'],directory),out)
  const inventory=await archiveInventory(before)
  assert.equal(inventory.tables.lk_agreements,1)
  assert.ok(inventory.files.length>0)
  assert.ok(edge.queries>0)
  await runCommand(project,parse(['export','--target','remote','--output',after,'--no-queue'],directory),out)
  assert.equal((await compareArchives(before,after)).files,inventory.files.length)
  let rows=[],calendar=[]
  for await(const record of fileRecords(before))if(record.kind==='part'){rows.push(...record.items.filter(item=>item.kind==='row'&&item.table==='lk_agreements'));calendar.push(...record.items.filter(item=>item.kind==='row'&&item.table==='lk_calendar_connections'))}
  assert.equal(rows[0].row.title,'Renewal services')
  assert.equal(calendar.length,1,'Calendar configuration record is retained')
  assert.equal(calendar[0].row.token,undefined,'Provider credentials stay outside the recovery archive')
  edge.replace()
  await assert.rejects(runCommand(project,parse(['export','--target','remote','--output',join(directory,'exports/refused.rer'),'--no-queue'],directory),out),/update-owned-worker-replaced/)
  await assert.rejects(runCommand(project,parse(['import','--target','remote','--input',before,'--yes','--no-queue'],directory),out),/Hosted restore is unsupported/)
 }finally{
  globalThis.fetch=savedFetch
  for(const key of Object.keys(process.env))if(!(key in savedEnv))delete process.env[key]
  Object.assign(process.env,savedEnv)
  await h.close();await rm(directory,{recursive:true,force:true})
 }
})
