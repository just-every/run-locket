import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { file, pdf } from './api/files.mjs';

export function redact(text) {
 for (const name of ['CLOUDFLARE_API_TOKEN','MAIL_API_KEY']) if (process.env[name]) text=text.replaceAll(process.env[name],'[private]');
 return text.replace(/https?:\/\/\S*[?&]token=\S*/g,'[private owner entry]').replace(/RER_OPEN[^\n]*/g,'RER_OPEN [private]');
}
export async function command(args,{privateOutput=false}={}) {
 const proc=spawn('node_modules/.bin/rer',args,{env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},stdio:['ignore','pipe','pipe']});
 let output='';for(const stream of [proc.stdout,proc.stderr])stream.on('data',chunk=>{output+=chunk});
 const code=await new Promise((resolve,reject)=>{proc.once('error',reject);proc.once('close',resolve)});
 if(code!==0)throw Error(privateOutput?'Owner sign-in command failed; no private output printed.':redact(output).slice(-12000));
 if(!privateOutput)console.log(redact(output));
 return output;
}
export async function ownerBrowser(environment,evidence) {
 const output=await command(['signin','--environment',environment,'--json'],{privateOutput:true});
 const entered=output.split('\n').flatMap(line=>{try{return [JSON.parse(line)]}catch{return []}}).find(item=>item.event==='result'&&item.link);
 assert.ok(entered?.link,'Native owner sign-in returned its private entry in memory.');
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});
 const context=await browser.newContext(),page=await context.newPage();
 await page.goto(entered.link);await page.getByRole('button',{name:'Confirm',exact:true}).click();
 if(new URL(page.url()).pathname==='/setup'){
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Finish setup',exact:true}).click();
 }
 const origin=new URL(page.url()).origin;
 async function cmd(type,payload){const response=await context.request.post(origin+'/api/locket/commands',{headers:{origin},data:{commandId:randomUUID(),type,payload}});const body=await response.json();assert.equal(response.status(),200,JSON.stringify(body));return body.result}
 return {browser,context,page,origin,cmd,async state(){const response=await context.request.get(origin+'/api/locket/state');assert.equal(response.status(),200);return response.json()},async populate(){
  await cmd('notification.preferences',{inApp:true,email:false,digest:false,timezone:'America/New_York'});
  return cmd('request.create',{title:'Fieldstone managed services renewal',type:'supplier',party:{name:'Fieldstone Services',kind:'supplier'},file:file('services.pdf',pdf('Fieldstone managed services. Annual value USD 48,000. Notice sixty days before expiry.'))});
 },async screens(id,phase){
  await mkdir(evidence,{recursive:true});
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app#agreement/'+id);await page.getByText('Fieldstone managed services renewal',{exact:true}).first().waitFor();await page.screenshot({path:join(evidence,`ops-${phase}-${width}.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Agreement workspace fits the viewport')}
 }};
}
