import type { AuditEntry, Ctx } from './commands'
import { sql, type Sql } from './model'

/** The status after the business writes is recorded in that same guarded batch.
 * Retries return the original command before reaching this code. */
export async function workflowWrites(c: Ctx, audit: AuditEntry[]): Promise<Sql[]> {
  const writes: Sql[] = []
  for (const id of new Set(audit.flatMap(a => a.agreementId ? [a.agreementId] : []))) {
    const before = await c.db.prepare('SELECT status FROM lk_agreements WHERE id=?').bind(id).first<{ status: string }>()
    writes.push(sql(`INSERT INTO lk_workflow_history
      SELECT ?,id,?,status,?,? FROM lk_agreements WHERE id=? AND status IS NOT ?`,
      `${c.commandId}:${id}`, before?.status ?? null, c.now, c.commandId, id, before?.status ?? null))
  }
  return writes
}
