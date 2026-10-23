import type { Ctx } from './commands'
import { fail,sql } from './model'
/** A previously approved letter never authorizes sending in a different term. */
export const renewalNoticeCheck=(noticeId:string)=>sql('EXISTS(SELECT 1 FROM lk_notices n JOIN lk_renewals r ON r.id=n.renewal_id WHERE n.id=? AND n.generation_id IS r.generation_id AND n.term_number=r.term_number)',noticeId)
export async function currentRenewalNotice(c:Ctx,id:string){
 const check=renewalNoticeCheck(id)
 if(!(await c.db.prepare(`SELECT (${check.sql}) AS ok`).bind(...check.params).first<{ok:number}>())?.ok)fail('STALE','This approved notice belongs to an earlier term or superseded derivation. Review a current notice before sending.',409)
 return check
}
