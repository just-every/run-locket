import type { AuditEntry, Ctx } from './commands'
import { sql, type Sql } from './model'

/** All observations follow the business writes inside their session/role/version
 * guard. A retry returns its original command before reaching this function. */
export async function workflowWrites(c: Ctx, audit: AuditEntry[]): Promise<Sql[]> {
  const writes: Sql[] = []
  for (const id of new Set(audit.flatMap(a => a.agreementId ? [a.agreementId] : []))) {
    const before = await c.db.prepare('SELECT status FROM lk_agreements WHERE id=?').bind(id).first<{ status: string }>()
    const actions = audit.filter(a => a.agreementId === id).map(a => a.action)
    writes.push(sql(`INSERT INTO lk_workflow_history
      SELECT ?,id,?,status,?,? FROM lk_agreements WHERE id=? AND status IS NOT ?`,
      `${c.commandId}:${id}`, before?.status ?? null, c.now, c.commandId, id, before?.status ?? null))
    // Keep the working queue and measured stages aligned at actual business
    // transitions. Mere comments, reminders and reads never invent a stage start.
    if (actions.includes('agreement.submit')) {
      writes.push(sql("UPDATE lk_request_work SET stage='approval' WHERE agreement_id=?", id))
    } else if (actions.includes('version.add') || actions.includes('version.edit')) {
      writes.push(sql(`UPDATE lk_request_work SET stage=CASE WHEN
        (SELECT kind FROM lk_versions WHERE id=(SELECT current_version_id FROM lk_agreements WHERE id=?))='counterparty'
        THEN 'negotiation' ELSE 'drafting' END WHERE agreement_id=?`, id, id))
    } else {
      writes.push(sql(`UPDATE lk_request_work SET stage='approval' WHERE agreement_id=?
        AND EXISTS(SELECT 1 FROM lk_agreements WHERE id=? AND status='in_review' AND status IS NOT ?)`, id, id, before?.status ?? null))
    }
    const stage = `CASE WHEN a.status IN ('approved','out_for_signature') THEN 'signature'
      WHEN a.status IN ('executed','cancelled') THEN a.status ELSE w.stage END`
    const changed = !before || actions.some(a => ['request.stage','agreement.submit','version.add','version.edit','request.reopen'].includes(a))
    writes.push(sql(`INSERT INTO lk_workflow_stages
      SELECT ?,a.id,(SELECT to_stage FROM lk_workflow_stages WHERE agreement_id=a.id ORDER BY at DESC,rowid DESC LIMIT 1),${stage},?,?
      FROM lk_agreements a JOIN lk_request_work w ON w.agreement_id=a.id
      WHERE a.id=? AND a.origin='intake' AND (? OR a.status IS NOT ?)
      AND ${stage} IS NOT (SELECT to_stage FROM lk_workflow_stages WHERE agreement_id=a.id ORDER BY at DESC,rowid DESC LIMIT 1)`,
      `${c.commandId}:${id}:stage`, c.now, c.commandId, id, Number(changed), before?.status ?? null))
    if (actions.includes('request.create') || actions.includes('request.reopen')) {
      writes.push(sql(`INSERT INTO lk_workflow_service_levels
        SELECT a.id,w.generation,w.team_id,?,w.due_at,NULL,NULL FROM lk_agreements a
        JOIN lk_request_work w ON w.agreement_id=a.id WHERE a.id=? AND a.origin='intake'`, c.now, id))
    }
    writes.push(sql(`UPDATE lk_workflow_service_levels SET closed_at=?,outcome=(SELECT status FROM lk_agreements WHERE id=?)
      WHERE agreement_id=? AND closed_at IS NULL AND EXISTS(SELECT 1 FROM lk_agreements WHERE id=? AND status IN ('executed','cancelled'))`, c.now, id, id, id))
  }
  return writes
}
