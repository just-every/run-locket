import { createHmac, randomUUID } from 'node:crypto'
export async function slackLaunch(h,providerId,{shortcut=false,secret='synthetic-locket-signing',timestamp=Math.floor(Date.now()/1000),body}={}){
 const raw=body??new URLSearchParams(shortcut?{payload:JSON.stringify({type:'message_action',callback_id:'locket_contract',user:{id:providerId},trigger_id:randomUUID(),response_url:'https://hooks.slack.com/actions/synthetic-locket-1'})}:{command:'/contract',user_id:providerId,trigger_id:randomUUID()}).toString()
 const signature='v0='+createHmac('sha256',secret).update(`v0:${timestamp}:${raw}`).digest('hex')
 return h.mf.dispatchFetch(h.origin+'/api/locket/chat-intake/slack',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-slack-request-timestamp':String(timestamp),'x-slack-signature':signature},body:raw})
}
export const launchToken=message=>message.text.match(/#new\/slack\/([^|>]+)/)[1]
