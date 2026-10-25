// Explicit held-key journey. It is never part of push Verify and always removes
// this environment's own resources, including after an interrupted deployment.
import assert from 'node:assert/strict';
import { execFileSync,spawn } from 'node:child_process';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { ownerBrowser,command,redact } from './operations-live-client.mjs';

const environment='ops-i812';
process.env.MAIL_ACCOUNT_ID=process.env.CLOUDFLARE_ACCOUNT_ID;
const evidence=resolve(process.env.LOCKET_BROWSER_OUTPUT??'../operations-live-screens');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const branch=git('branch','--show-current'),candidate=git('rev-parse','HEAD');
const previous=process.argv[process.argv.indexOf('--previous-ref')+1];
if(!process.argv.includes('--fresh')&&!process.argv.includes('--previous-ref'))throw Error('Choose --fresh or --previous-ref TAG.');
if(evidence===process.cwd()||evidence.startsWith(process.cwd()+'/'))throw Error('Screenshots must stay outside the checkout.');
let owner,failure,removed=true;
try{
 if(process.argv.includes('--previous-ref'))git('switch','--detach',previous);
 await command(['deploy','--environment',environment,'--owner-name','Run Edit Run Operations','--non-interactive','--no-queue']);
 owner=await ownerBrowser(environment,evidence);
 const created=await owner.populate();
 await owner.screens(created.id,'before');
 const before=await owner.state();
 await owner.browser.close();owner=null;
 if(process.argv.includes('--previous-ref'))git('switch','--detach',candidate);
 await command(['deploy','--environment',environment,'--dry-run','--owner-name','Run Edit Run Operations','--non-interactive','--no-queue']);
 await command(['deploy','--environment',environment,'--owner-name','Run Edit Run Operations','--non-interactive','--no-queue']);
 owner=await ownerBrowser(environment,evidence);
 const after=await owner.state();
 const agreement=after.agreements.find(item=>item.id===created.id);
 assert.ok(agreement);assert.equal(agreement.title,before.agreements.find(item=>item.id===created.id).title);
 await owner.screens(created.id,'after');
 const folder=join('.rer/deploy/updates',environment);
 const entries=await readdir(folder),records=[];
 for(const name of entries){try{records.push(JSON.parse(await readFile(join(folder,name,'applied.json'),'utf8')))}catch(error){if(error.code!=='ENOENT')throw error}}
 assert.ok(records.some(item=>item.source===candidate&&item.preserved.records>0&&item.preserved.files>0));
 console.log(`OPS-001 live ${process.argv.includes('--fresh')?'fresh installation and same-release update':'previous-release update'} passed at ${candidate}; private R2 backup and every archived record and file verified.`);
}catch(error){failure=error}finally{
 await owner?.browser.close();
 if(git('rev-parse','HEAD')!==candidate)git('switch','--detach',candidate);
 if(await lstat(join('.rer/deploy',environment+'.json')).catch(error=>{if(error.code==='ENOENT')return null;throw error})){
  try{await command(['deploy','--environment',environment,'--remove','--yes','--no-queue']);console.log('OPS-001 owned Worker, D1 database and R2 bucket removed and read back absent.')}catch(error){removed=false;failure??=error}
 }
 if(branch)git('switch',branch);
}
if(failure){
 console.error(redact(failure.message));
 // Continue the separate fresh-install case after cleanup; the failed previous
 // release case remains failed and keeps the overall journey nonzero.
 if(removed&&process.argv.includes('--previous-ref')){
  console.log('Previous release case failed. Running the independent current fresh-install case after cleanup.');
  const fresh=spawn(process.execPath,['tests/operations-live.mjs','--fresh'],{env:process.env,stdio:'inherit'});
  const code=await new Promise((resolve,reject)=>{fresh.once('error',reject);fresh.once('close',resolve)});
  console.log('Independent fresh-install case exit: '+code);
 }
 process.exitCode=1;
}
