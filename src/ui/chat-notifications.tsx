import type { LocketState, Row } from './api'
import type { Locket } from './app'
import { Field, Form, value } from './controls'

export interface ChatWorkspace {preferences:{channels:string[];version:number};identities:Row[];deliveries:Row[]}
const names={slack:'Slack',teams:'Teams',nook:'Nook'}
const outcomes:Record<string,string>={accepted:'Provider accepted; delivery unconfirmed',sending:'In progress or interrupted; no automatic retry',uncertain:'Outcome unknown; no automatic retry',suppressed:'Withheld; nothing sent',cancelled:'Cancelled after access or source changed',rejected:'Provider rejected',rate_limited:'Provider rate limited',queued:'Queued; acceptance unconfirmed'}
export function ChatNotifications({state,locket,personalOnly}:{state:LocketState;locket:Locket;personalOnly:boolean}){
 const w=state.chatNotifications
 if(state.actor.role==='agent')return null
 return <>
 <section className="lk-panel" aria-label="Chat status notifications"><h2>Chat status notifications</h2>
 <p>Choose generic assignment, mention, approval and signature updates in your owner-bound conversation. Every human member must have current Locket access. Unmapped members or an unavailable membership check withhold the message.</p>
 <p>Nook status delivery is unavailable until its membership API ships. Daily digest mode withholds chat updates; your email digest continues normally. Enabling a channel applies only to new events.</p>
 <Form key={w.preferences.version} busy={locket.busy} submit="Save chat updates" onSubmit={data=>void locket.run('notification.chat.preferences',{version:w.preferences.version,channels:Object.keys(names).filter(k=>data.get(k)==='on')})}>
 {Object.entries(names).map(([channel,label])=><Field key={channel} label={`${label} status updates`}><input type="checkbox" name={channel} defaultChecked={w.preferences.channels.includes(channel)}/></Field>)}
 </Form>
 <ul aria-label="Chat update receipts">{w.deliveries.map(d=><li key={d.id}>{names[d.channel as keyof typeof names]} · {outcomes[d.status]??'Unconfirmed'}{d.code==='audience_unverified'?' · Conversation membership or access could not be verified':d.code==='chat_digest_not_available'?' · Chat digest unavailable':''}</li>)}</ul>
 </section>
 {!personalOnly&&state.actor.role==='owner'&&<section className="lk-panel" aria-label="Chat member mapping"><h2>Chat member mapping</h2>
 <p>Map exact provider member identities to active Locket accounts. This grants no record access. Bind the receiving conversation below. Slack requires member-list access and a bot token; Teams requires chat member read access as well as message sending.</p>
 <Form busy={locket.busy} submit="Map chat member" onSubmit={data=>{const channel=value(data,'channel'),providerId=value(data,'providerId'),prior=w.identities.find(i=>i.channel===channel&&i.provider_id===providerId);return void locket.run('notification.chat.identity',{channel,providerId,operatorId:value(data,'operatorId'),version:prior?.version??0})}}>
 <Field label="Chat identity provider"><select name="channel">{Object.entries(names).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></Field>
 <Field label="Provider member identity"><input name="providerId" required maxLength={300}/></Field>
 <Field label="Locket member"><select name="operatorId">{state.operators.filter(o=>o.status==='active'&&o.role!=='agent').map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
 </Form>
 <ul>{w.identities.map(i=><li key={i.channel+':'+i.provider_id} style={{overflowWrap:'anywhere'}}>{names[i.channel as keyof typeof names]} · {i.provider_id} · {state.operators.find(o=>o.id===i.operator_id)?.name??'Member'}</li>)}</ul>
 </section>}
 </>
}
