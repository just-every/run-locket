import {file,pdf} from './files.mjs'
export async function approvalRuleFixture(h){
 const finance=await h.invite('synthetic-locket-finance@example.test','approver'),security=await h.invite('synthetic-locket-security@example.test','approver'),cfo=await h.invite('synthetic-locket-cfo@example.test','approver'),delegate=await h.invite('synthetic-locket-delegate@example.test','approver'),requester=await h.invite('synthetic-locket-requester@example.test','requester')
 const ownerId=(await h.owner.state()).actor.id
 const department=await h.owner.command('audience.save',{name:'Operations',kind:'department',memberIds:[requester.id]})
 const rules=[{name:'Finance',approverId:finance.id,escalationId:ownerId,order:1,when:{type:'supplier',minimumValue:'100000',departmentId:department.id}},{name:'Security',approverId:security.id,escalationId:ownerId,order:2,when:{dataProcessing:true}},{name:'CFO',approverId:cfo.id,escalationId:ownerId,order:3,when:{minimumValue:'500000'}}]
 return {finance,security,cfo,delegate,requester,ownerId,department,rules}
}
export async function ruleRequest(owner,requester,departmentId,{value='600000',dataProcessing=true,title='synthetic-locket-600000',restricted=false}={}){
 const created=await requester.command('request.create',{title,type:'supplier',value,restricted,party:{name:title+' supplier',kind:'supplier'},file:file(title+'.pdf',pdf('Supplier agreement '+title)),text:'Supplier agreement '+title})
 let state=await owner.state(),a=state.agreements.find(a=>a.id===created.id)
 await owner.command('agreement.department',{agreementId:a.id,version:a.version,departmentId})
 a=(await owner.state()).agreements.find(a=>a.id===created.id)
 await requester.command('approval.inputs',{agreementId:a.id,version:a.version,risk:'medium',dataProcessing})
 for(const r of (await owner.state()).requirements.filter(r=>r.agreement_id===created.id))await owner.command('requirement.attach',{agreementId:a.id,requirementId:r.id,file:file(r.label+'.pdf',pdf(r.label))})
 return created.id
}
export async function ruleDecision(client,id,step,options={}){
 const a=(await client.state()).agreements.find(a=>a.id===id)
 return client.command('approval.decide',{agreementId:id,version:a.version,versionId:a.current_version_id,kind:'commercial',deviationId:step,decision:'approved'},options)
}
