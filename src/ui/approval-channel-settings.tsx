import { ChatNotifications } from './chat-notifications'
import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'
import { can, currentVersion } from './format'

const names={email:'Email',slack:'Slack',teams:'Teams',nook:'Nook',word:'Word',phone:'Phone'}
export interface ApprovalChannelWorkspace {
 preferences:{channels:string[];version:number}
 settings:{automatic:boolean;version:number}
 bindings:Row[]
 requests:Row[]
 deliveries:Row[]
 providers:{email:boolean;slack:boolean;teams:boolean;nook:boolean}
}
type State=LocketState&{approvalChannels:ApprovalChannelWorkspace}
export function ApprovalChannelSettings({state,locket,personalOnly=false}:{state:State;locket:Locket;personalOnly?:boolean}){
 const w=state.approvalChannels
 if(state.actor.role==='agent')return null
 return <>
  <ChatNotifications state={state} locket={locket} personalOnly={personalOnly}/>
  <section className="lk-panel" aria-label="Personal approval channels">
   <h2>Personal approval channels</h2><p>Choose where approval requests and their reminders reach you. Chat requires an owner-bound conversation. Email also follows your notification email and daily digest preferences. Every link requires your current Locket sign-in.</p>
   <Form key={w.preferences.version} busy={locket.busy} submit="Save approval channels" onSubmit={data=>void locket.run('approval.channel.preferences',{version:w.preferences.version,channels:Object.keys(names).filter(channel=>data.get(channel)==='on')})}>
    {Object.entries(names).map(([channel,label])=><Field key={channel} label={`${label} approval requests`}><input name={channel} type="checkbox" defaultChecked={w.preferences.channels.includes(channel)}/></Field>)}
   </Form>
   <p><a href="#approval-word">Open Word and phone approval inbox</a> · <a href="/api/locket/approval-channels/word-manifest" download="locket-approvals.xml">Download Word add-in manifest</a></p>
  </section>
  {!personalOnly&&can(state,'owner')&&<section className="lk-panel" aria-label="Approval channel configuration">
   <h2>Approval channel configuration</h2><p>Automatic requests ask the current unlocked named approver or delegate. Steps without a named approver ask every eligible role member with access. Requests contain only a generic sign-in link. Provider acceptance confirms neither delivery nor reading.</p>
   <Form key={w.settings.version} busy={locket.busy} submit="Save automatic approval requests" onSubmit={data=>void locket.run('approval.channel.configure',{version:w.settings.version,automatic:data.get('automatic')==='on'})}>
    <Field label="Enable automatic approval requests"><input name="automatic" type="checkbox" defaultChecked={w.settings.automatic}/></Field>
   </Form>
   <p>Provider credentials are installation secrets: APPROVAL_SLACK_TOKEN (chat:write), APPROVAL_TEAMS_TOKEN (delegated ChatMessage.Send), APPROVAL_NOOK_ORIGIN and APPROVAL_NOOK_TOKEN (Nook Slack-compatible posting). Never enter a credential as a conversation identity.</p>
   <p>{Object.entries(w.providers).map(([channel,ready])=>`${channel}: ${ready?'configured':'needs configuration'}`).join(' · ')}</p>
   <Form busy={locket.busy} submit="Bind approval conversation" onSubmit={data=>{
    const operatorId=value(data,'operatorId'),channel=value(data,'channel'),binding=w.bindings.find(b=>b.operator_id===operatorId&&b.channel===channel)
    return void locket.run('approval.channel.bind',{operatorId,channel,destination:value(data,'destination'),version:binding?.version??0})
   }}>
    <Field label="Conversation member"><select name="operatorId">{state.operators.filter(o=>o.status==='active'&&o.role!=='agent').map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
    <Field label="Approval chat provider"><select name="channel"><option value="nook">Nook</option><option value="slack">Slack</option><option value="teams">Teams</option></select></Field>
    <Field label="Provider conversation identity" hint="Use a direct conversation where this member receives requests; links grant no record access."><input name="destination" required maxLength={300}/></Field>
   </Form>
   <ul>{w.bindings.map(b=><li key={b.operator_id+':'+b.channel} style={{overflowWrap:'anywhere'}}>{state.operators.find(o=>o.id===b.operator_id)?.name??'Member'} · {b.channel} · {b.destination}</li>)}</ul>
  </section>}
 </>
}
export function ApprovalChannelRequest({state,a,locket}:{state:State;a:Row;locket:Locket}){
 const v=currentVersion(state,a)
 if(!v||a.status!=='in_review'||!can(state,'owner','counsel','approver','requester'))return null
 const routes=state.routes[a.id]??[]
 return <section className="lk-panel" aria-label="Request approval through personal channels"><h2>Request approval through personal channels</h2>
  <Form busy={locket.busy} submit="Request approval" onSubmit={async data=>{
   const target=routes[Number(value(data,'step'))]
   const result=await locket.run('approval.channel.request',{agreementId:a.id,version:a.version,versionId:v.id,kind:target.kind,deviationId:target.deviationId,recipientId:value(data,'recipientId')})
   if(result)locket.setNotice('Approval request recorded. Check channel receipts below; provider acceptance does not confirm delivery.')
  }}>
   <Field label="Requested approval step"><select name="step">{routes.map((r,i)=><option key={i} value={i}>{r.label}</option>)}</select></Field>
   <Field label="Requested approver"><select name="recipientId">{state.operators.filter(o=>o.status==='active'&&['owner','approver','counsel'].includes(o.role)).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
  </Form><p>Each recipient’s personal channels apply. Only a current eligible approver with access can be selected.</p>
  <ApprovalChannelReceipts state={state} agreementId={a.id}/>
 </section>
}
export function ApprovalChannelReceipts({state,agreementId}:{state:State;agreementId?:string}){
 const w=state.approvalChannels
 // Deliveries are already server scoped; own request links stay private to the recipient.
 const rows=w.deliveries.filter(d=>!agreementId||d.agreement_id===agreementId)
 const label=(d:Row)=>d.code==='daily_digest'?'Waiting for daily digest; no email sent':d.status==='accepted'?'Provider accepted; delivery and reading unconfirmed':d.status==='available'?'Available in signed-in inbox':d.status==='sending'||d.status==='uncertain'?'Outcome unknown or in progress; no automatic retry':d.status==='suppressed'?'Suppressed; nothing sent':d.status==='cancelled'?'Cancelled after authority or record changed':d.status==='queued'?'Queued; acceptance unconfirmed':d.status==='rate_limited'?'Provider rate limited; acceptance unconfirmed':'Provider did not accept'
 return <ul aria-label="Approval channel receipts">{rows.map(d=><li key={d.id}>{names[d.channel as keyof typeof names]} · {label(d)}</li>)}</ul>
}
export function ApprovalChannelInbox({state}:{state:State}){
 const w=state.approvalChannels,enabled=w.preferences.channels.includes('word')||w.preferences.channels.includes('phone')
 return <section className="lk-panel" aria-label="Word and phone approvals"><h1>Word and phone approvals</h1>
  <p>Sign in to review your requests. The Word task pane shows Locket records; it does not infer that the open Word document matches a stored version. Review the exact stored version before deciding.</p>
  {enabled?<ul>{w.requests.map(r=><li key={r.id}><a href={`#approval-request/${r.id}`}>{state.agreements.find(a=>a.id===r.agreement_id)?.title??'Approval request'}</a> · {r.source}</li>)}</ul>:<p>Word and phone requests are disabled in your personal approval channels.</p>}
  <ApprovalChannelReceipts state={state}/>
 </section>
}
