// Internal scheduled reads have no browser session. Their authority is the
// enabled report and selected active person, checked in the same batch as the
// attributed read audit. No HTTP request can select this context.
import type { Bindings } from '../auth.server'
import { roleSql, visibleSql } from './access'
import { auditSql, guardSql } from './commands'
import { sql, type Actor } from './model'

export interface ScheduledReportRead { deliveryId:string; reportId:string; reportVersion:number; now:number }
export async function recordReportReads(env:Bindings,actor:Actor,agreements:{id:string;version:number;restricted:number}[],source:ScheduledReportRead){
  const sourceCheck=sql(`EXISTS(SELECT 1 FROM lk_reports r JOIN lk_report_deliveries d ON d.report_id=r.id JOIN oa_operators owner ON owner.id=r.created_by
    WHERE r.id=? AND r.version=? AND r.enabled=1 AND d.id=? AND d.recipient_id=? AND d.status='preparing'
    AND EXISTS(SELECT 1 FROM json_each(r.recipients) p WHERE p.value=?) AND owner.status='active'
    AND (CASE WHEN owner.role='owner' THEN 'owner' ELSE COALESCE((SELECT role FROM lk_roles WHERE operator_id=owner.id),'viewer') END) IN ('owner','counsel','approver','requester','viewer'))`,source.reportId,source.reportVersion,source.deliveryId,actor.id,actor.id)
  const checks=[sourceCheck,sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status='active')",actor.id,actor.operatorVersion),sql(`${roleSql}=?`,actor.id,actor.role)]
  const restricted=agreements.filter(a=>a.restricted)
  for(const a of restricted)checks.push(visibleSql(actor,a.id),sql('(SELECT version FROM lk_agreements WHERE id=?)=?',a.id,a.version))
  const c={env,db:env.DB,actor,now:source.now,commandId:source.deliveryId}
  const entries=[{action:'report.read',summary:'Read the currently permitted workspace for an authorized scheduled report.'},...restricted.map(a=>({action:'report.read',agreementId:a.id,summary:'Read a restricted agreement for an authorized scheduled report.'}))]
  const guard=crypto.randomUUID()
  await env.DB.batch([guardSql(guard,checks),...entries.map(e=>auditSql(c,e,'scheduler')),sql('DELETE FROM lk_guard WHERE id=?',guard)].map(s=>env.DB.prepare(s.sql).bind(...s.params)))
}
