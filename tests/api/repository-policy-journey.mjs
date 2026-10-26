import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {file,pdf} from './files.mjs'

export async function businessCommands(){
 const bundled=await build({stdin:{contents:"import {handlers} from './src/locket/api'; export default Object.keys(handlers)",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node',target:'es2022',external:['node:*'],banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(process.cwd()+'/package.json');"},logLevel:'silent'})
 const {default:names}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'))
 return names.filter(name=>name!=='agreement.hidden-value'&&! /^(view\.|notification\.|preferences\.)/.test(name))
}

// Continue the repository journey through the policy's consequential public doors.
export async function repositoryPolicyJourney(h){
 const configure=async values=>h.owner.command('repository.access',{...(await h.owner.state()).repositoryPolicy,...values})
 await configure({enabled:false,hiddenFields:[],grants:[]})
 const requester=await h.invite('synthetic-locket-policy-requester@example.test','requester')
 const approver=await h.invite('synthetic-locket-policy-approver@example.test','approver')
 const own=(await h.owner.state()).actor.id
 const group=await h.owner.command('audience.save',{name:'Policy Sales',kind:'group',memberIds:[approver.id]})
 const department=await h.owner.command('audience.save',{name:'Policy Sales department',kind:'department',memberIds:[]})
 const create=client=>client.command('request.create',{title:'synthetic-locket-policy-748392.56',type:'customer',value:'748392.56',party:{name:'synthetic-locket-policy-party',kind:'customer'},text:'Secret pricing 748392.56',file:file('policy-pricing.pdf',pdf('Secret pricing 748392.56'))})
 const agreement=await create(requester),unclassified=await create(h.owner)
 const row=async id=>(await h.owner.state()).agreements.find(a=>a.id===id)
 let a=await row(agreement.id)
 assert.equal(a.requester_id,requester.id)
 assert.ok((await requester.state()).agreements.some(a=>a.id===agreement.id),'requester sees own agreement before policy')
 await h.owner.command('agreement.department',{agreementId:a.id,version:a.version,departmentId:department.id})
 const grants=[{audienceId:group.id,types:['customer'],departmentIds:[department.id]}]
 await configure({enabled:true,grants})
 assert.ok(!(await requester.state()).agreements.some(a=>a.id===agreement.id),'unmatched requester loses own agreement')
 assert.ok((await approver.state()).agreements.some(a=>a.id===agreement.id),'matching classified agreement remains readable')
 assert.ok(!(await approver.state()).agreements.some(a=>a.id===unclassified.id),'unclassified agreement is outside department grant')
 await h.owner.command('audience.save',{...group,name:'Policy Sales',kind:'group',memberIds:[approver.id,requester.id]})
 assert.ok((await requester.state()).agreements.some(a=>a.id===agreement.id),'current group membership restores own agreement')

 const rules=[{id:'synthetic-locket-hidden-step',name:'Named Sales approver',approverId:approver.id,order:1,when:{type:'customer'}},{id:'synthetic-locket-owner-step',name:'Owner decision',approverId:own,order:2,when:{type:'customer'}}]
 await h.owner.command('approval.rules.save',{version:0,rules})
 await h.owner.command('approval.rules.preview',{version:1,sample:{type:'customer',value:'748392.56',departmentId:department.id,risk:'unknown',dataProcessing:false,findingKeys:[]}})
 await h.owner.command('approval.rules.publish',{version:1})
 const routed=await create(requester)
 a=await row(routed.id)
 await h.owner.command('agreement.department',{agreementId:a.id,version:a.version,departmentId:department.id})
 assert.deepEqual((await h.owner.state()).routes[routed.id].map(r=>r.approverId),[approver.id,own],'matching named step is required before hiding')
 await configure({hiddenFields:[{role:'requester',fields:['value']},{role:'approver',fields:['value']}]})
 assert.deepEqual((await h.owner.state()).routes[routed.id].map(r=>r.approverId),[own],'hidden-field approver is skipped while unrestricted owner remains')
 const commands=await businessCommands()
 assert.ok(commands.length,'exercise the current business command registry')
 for(const type of commands)await requester.command(type,{},{error:'FIELD_ACCESS'})
 await approver.command('approval.decide',{agreementId:agreement.id},{error:'FIELD_ACCESS'})
 a=await row(routed.id)
 for(const required of (await h.owner.state()).requirements.filter(r=>r.agreement_id===a.id))await h.owner.command('requirement.attach',{agreementId:a.id,requirementId:required.id,file:file('order-form.pdf',pdf('Secret pricing 748392.56'))})
 a=await row(a.id)
 await h.owner.command('agreement.submit',{agreementId:a.id,version:a.version})
 a=await row(a.id)
 await h.owner.command('approval.decide',{agreementId:a.id,version:a.version,versionId:a.current_version_id,kind:'commercial',deviationId:'rule:synthetic-locket-owner-step',decision:'approved'})
 assert.equal((await row(a.id)).status,'approved','skipped hidden-field step cannot block approval')

 const timezone=['America','New_York'].join('/')
 const at=Date.parse('2026-10-27T12:00:00Z')
 await h.setTime(at)
 await requester.command('notification.preferences',{inApp:true,email:true,digest:false,timezone})
 let count=h.mails.length
 const mention=()=>h.owner.command('comment.add',{agreementId:a.id,versionId:a.current_version_id,body:'Secret pricing 748392.56',mentionIds:[requester.id]})
 await mention()
 const immediate=h.mails.slice(count)
 assert.equal(immediate.length,1,'hidden-field recipient receives an immediate mention')
 assert.equal((await requester.state()).notifications.items.find(n=>n.kind==='mention'&&n.agreement_id===a.id).email_status,'accepted')
 await requester.command('notification.preferences',{inApp:true,email:true,digest:true,timezone})
 count=h.mails.length
 await mention()
 assert.equal(h.mails.length,count,'digest mention waits for its scheduled send')
 await h.setTime(Date.parse('2026-10-27T13:00:00Z'))
 await h.scheduled(Date.parse('2026-10-27T13:00:00Z'))
 const digest=h.mails.slice(count).filter(m=>m.to.includes('synthetic-locket-policy-requester@example.test'))
 assert.equal(digest.length,1,'hidden-field recipient receives the digest at local nine')
 for(const mail of [...immediate,...digest]){
  assert.ok(mail.to.includes('synthetic-locket-policy-requester@example.test'))
  assert.ok(mail.text.includes(h.origin+'/app#agreement/'+a.id),'mail links to the current authenticated agreement')
  for(const secret of ['748392','748,392','Secret pricing','synthetic-locket-policy-748392.56'])assert.ok(!JSON.stringify(mail).includes(secret),'hidden value and source text never enter provider payload')
 }
 assert.ok((await h.owner.state()).audit.filter(e=>e.action==='repository.access').every(e=>e.actor_id===own&&e.actor_role==='owner'))
}
