import type { Bindings } from '../auth.server'
import { may, requireRole } from './access'
import type { Handler } from './commands'
import { bool, fail, integer, json, list, oneOf, sql, text } from './model'
import { activeHumanSql, notificationPeople } from './notifications'

export const approvalChannels = ['email','slack','teams','nook','word','phone'] as const
export type ApprovalChannel = typeof approvalChannels[number]
export interface ApprovalChannelBindings {
 APPROVAL_SLACK_TOKEN?: string
 /** Microsoft Graph delegated work-account token with ChatMessage.Send. */
 APPROVAL_TEAMS_TOKEN?: string
 APPROVAL_NOOK_ORIGIN?: string
 APPROVAL_NOOK_TOKEN?: string
}
export const channelEnv = (env: Bindings) => env as Bindings & ApprovalChannelBindings
export async function channelPreferences(db: D1Database, id: string) {
 const row=await db.prepare('SELECT channels,version FROM lk_approval_channel_preferences WHERE operator_id=?').bind(id).first<{channels:string;version:number}>()
 return {channels:row?JSON.parse(row.channels) as ApprovalChannel[]:['email','word','phone'] as ApprovalChannel[],version:row?.version??0}
}
export async function channelSettings(db: D1Database) {
 const row=await db.prepare("SELECT automatic,version FROM lk_approval_channel_settings WHERE id='installation'").first<{automatic:number;version:number}>()
 return {automatic:row?.automatic===1,version:row?.version??0}
}
export const channelSettingsCheck = (version:number) => sql("COALESCE((SELECT version FROM lk_approval_channel_settings WHERE id='installation'),0)=?",version)
export const channelPreferenceCheck = (id:string,version:number) => sql('COALESCE((SELECT version FROM lk_approval_channel_preferences WHERE operator_id=?),0)=?',id,version)

const configure: Handler=async(c,p)=>{
 requireRole(c.actor,may.manageRoles,'configure automatic approval requests')
 const version=integer(p,'version',0),automatic=bool(p,'automatic')
 if((await channelSettings(c.db)).version!==version)fail('STALE','Approval channel settings changed. Reload.',409)
 return {allowed:may.manageRoles,result:{automatic,version:version+1},checks:[channelSettingsCheck(version)],writes:[sql("INSERT INTO lk_approval_channel_settings VALUES('installation',?,1,?,?) ON CONFLICT(id) DO UPDATE SET automatic=excluded.automatic,version=lk_approval_channel_settings.version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at",Number(automatic),c.actor.id,c.now)],audit:[{action:'approval.channels.configure',summary:automatic?'Owner enabled automatic generic approval requests through each recipient’s personal channels.':'Owner disabled automatic approval requests.'}]}
}
const bind: Handler=async(c,p)=>{
 requireRole(c.actor,may.manageRoles,'bind approval chat destinations')
 const operatorId=text(p,'operatorId',100),channel=oneOf(p,'channel',['slack','teams','nook'] as const),version=integer(p,'version',0)
 const destination=text(p,'destination',300)
 if(/[\s<>"\\]/.test(destination))fail('INVALID','Use the exact provider conversation identity, without a URL or whitespace.')
 const prior=await c.db.prepare('SELECT version FROM lk_approval_channel_bindings WHERE operator_id=? AND channel=?').bind(operatorId,channel).first<{version:number}>()
 if((prior?.version??0)!==version)fail('STALE','This destination changed. Reload.',409)
 return {allowed:may.manageRoles,result:{operatorId,channel,version:version+1},checks:[activeHumanSql(operatorId),sql('COALESCE((SELECT version FROM lk_approval_channel_bindings WHERE operator_id=? AND channel=?),0)=?',operatorId,channel,version)],writes:[sql('INSERT INTO lk_approval_channel_bindings VALUES(?,?,?,1,?,?) ON CONFLICT(operator_id,channel) DO UPDATE SET destination=excluded.destination,version=lk_approval_channel_bindings.version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at',operatorId,channel,destination,c.actor.id,c.now)],audit:[{action:'approval.channels.bind',summary:`Owner bound a ${channel} conversation for an active member; personal consent is still required.`}]}
}
const preferences: Handler=async(c,p)=>{
 requireRole(c.actor,notificationPeople,'choose personal approval channels')
 if(p.operatorId!==undefined&&p.operatorId!==c.actor.id)fail('FORBIDDEN','Choose only your own approval channels.',403)
 const version=integer(p,'version',0),channels=list(p,'channels',6).map(v=>oneOf({v},'v',approvalChannels))
 if(new Set(channels).size!==channels.length)fail('INVALID','Choose each channel once.')
 if((await channelPreferences(c.db,c.actor.id)).version!==version)fail('STALE','Personal approval channels changed. Reload.',409)
 return {allowed:notificationPeople,result:{channels,version:version+1},checks:[activeHumanSql(c.actor.id),channelPreferenceCheck(c.actor.id,version)],writes:[sql('INSERT INTO lk_approval_channel_preferences VALUES(?,?,1,?) ON CONFLICT(operator_id) DO UPDATE SET channels=excluded.channels,version=lk_approval_channel_preferences.version+1,updated_at=excluded.updated_at',c.actor.id,json(channels),c.now)],audit:[{action:'approval.channels.preferences',summary:'Updated own approval channels. Chat opt-in grants no approval authority or agreement access.'}]}
}
export const approvalChannelConfigHandlers: Record<string,Handler>={'approval.channel.configure':configure,'approval.channel.bind':bind,'approval.channel.preferences':preferences}
