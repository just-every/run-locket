import type { Ctx,Handler } from './commands'
import type { Actor } from './model'
import type { AgreementRow } from './records'
import { coordinatorCheck,ruleDraft,signatureRuleHandlers } from './signature-rules'
import { signatureFieldHandlers } from './signature-fields'
import { signaturePacketHandlers } from './signature-packets'
import { signatureSendHandlers } from './signature-send'
import { signatureTagHandlers } from './signature-tag-review'
export { captureSignatureRuleSet } from './signature-rules'
export { signaturePacketContext } from './signature-packets'
export { dispatchSignature } from './signature-send'
export async function signatureState(db:D1Database,actor:Actor,visible:Set<string>) {
 const rows=async(table:string)=>(await db.prepare(`SELECT * FROM ${table}`).all<any>()).results
 const agreements=(await db.prepare('SELECT * FROM lk_agreements').all<AgreementRow>()).results.filter(a=>visible.has(a.id)),canCoordinate:string[]=[]
 for(const a of agreements){const check=coordinatorCheck({actor} as Ctx,a);if((await db.prepare(`SELECT ${check.sql} AS ok`).bind(...check.params).first<{ok:number}>())?.ok)canCoordinate.push(a.id)}
 return {
  rules:actor.role==='owner'?await ruleDraft(db):null,
  coordinators:actor.role==='owner'?await rows('lk_signature_coordinators'):[],
  connections:actor.role==='owner'?await rows('lk_signature_connections'):[],
  blocks:['owner','counsel'].includes(actor.role)?await rows('lk_signature_template_blocks'):[],
  packets:(await rows('lk_signature_packets')).filter(r=>visible.has(r.agreement_id)),
  renditions:(await rows('lk_signature_tag_renditions')).filter(r=>visible.has(r.agreement_id)),
  dispatches:(await rows('lk_signature_dispatches')).filter(r=>visible.has(r.agreement_id)),
  canCoordinate,
 }
}
// Compose at the HTTP registry after the cyclic domain imports have initialized.
export function signatureHandlers():Record<string,Handler>{return {...signatureRuleHandlers,...signatureFieldHandlers,...signaturePacketHandlers,...signatureSendHandlers,...signatureTagHandlers}}

export const signatureArchiveTables=['lk_signature_rule_drafts','lk_signature_rule_versions','lk_signature_rule_snapshots','lk_signature_coordinators','lk_signature_template_blocks','lk_signature_packets','lk_signature_packet_changes','lk_signature_connections','lk_signature_dispatches','lk_signature_tag_renditions']
