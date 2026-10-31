import type { AuditRow } from '../modules/agent-door/audit'

/** Public door history only. Never archive saved calls, policy evidence or credentials. */
export async function agentAuditExport(db: D1Database) {
  const approvals = (await db.prepare('SELECT id,state,saved,approvals,result FROM agent_door_approvals ORDER BY rowid').all<{
    id: string; state: string; saved: string; approvals: string; result: string | null
  }>()).results.map(record => {
    const saved = JSON.parse(record.saved)
    return { id: record.id, state: record.state, decision_id: saved.decision_id,
      revision: saved.revision, tool: saved.tool, expires_at: saved.expires_at,
      approvals: JSON.parse(record.approvals) as Array<{ ref: string; person: string; name: string; at: string }>,
      code: record.result ? JSON.parse(record.result).code ?? null : null }
  })
  const reviews = (await db.prepare(`SELECT r.id,r.state,r.saved,r.marked_by,r.marked_at,o.display_name AS marked_name
    FROM agent_door_reviews r LEFT JOIN oa_operators o ON o.id=r.marked_by ORDER BY r.rowid`).all<{
    id: string; state: string; saved: string; marked_by: string | null; marked_at: string | null; marked_name: string | null
  }>()).results.map(record => {
    const saved = JSON.parse(record.saved)
    return { id: record.id, state: record.state, decision_id: saved.decision_id, tool: saved.tool,
      marked_by: record.marked_by, marked_at: record.marked_at, marked_name: record.marked_name }
  })
  const approvalById = new Map(approvals.map(row => [row.id, row]))
  const reviewById = new Map(reviews.map(row => [row.id, row]))
  const rows = (await db.prepare('SELECT sequence,row FROM agent_door_audit ORDER BY sequence').all<{
    sequence: number; row: string
  }>()).results.map(record => {
    const row: AuditRow = JSON.parse(record.row)
    // Match every public AuditRow field explicitly; the private evidence column
    // and future storage-only fields cannot accidentally enter an archive.
    return {
      sequence: record.sequence, id: row.id, at: row.at, door: row.door,
      agent: row.agent, sponsor: row.sponsor, label: row.label,
      operation_id: row.operation_id, scopes: row.scopes, client_id: row.client_id,
      consent: row.consent, tool: row.tool, resource: row.resource, decision_id: row.decision_id,
      classes: row.classes, revision: row.revision, rules: row.rules, decision: row.decision,
      outcome: row.outcome, code: row.code,
      approval: row.approval ? { id: row.approval.id, by: [...new Set(
        (approvalById.get(row.approval.id)?.approvals ?? []).map(mark => mark.person))] } : null,
      review: row.review ? { id: row.review.id, by: reviewById.get(row.review.id)?.marked_by ?? null } : null,
      idempotency_key: row.idempotency_key, trace: row.trace,
      ignored_arguments: row.ignored_arguments, replay_of: row.replay_of,
      ...(row.authority === undefined ? {} : { authority: row.authority }),
      ...(row.continuation_item_id === undefined ? {} : { continuation_item_id: row.continuation_item_id }),
      ...(row.classification_refusal === undefined ? {} : { classification_refusal: row.classification_refusal }),
    }
  })
  // Decision events retain the signed-in person's name even for rejection,
  // which has no approval mark. Do not export policy-adoption envelopes.
  const decisions = (await db.prepare('SELECT event FROM agent_door_events ORDER BY sequence').all<{ event: string }>()).results
    .map(record => JSON.parse(record.event))
    .filter(event => ['approval.decided', 'review.flagged'].includes(event.type))
    .map(event => ({ id: event.id, type: event.type, uri: event.uri, at: event.at,
      actor: event.actor, decision_id: event.decision_id, classes: event.classes,
      ...(event.decision === undefined ? {} : { decision: event.decision }),
      ...(event.state === undefined ? {} : { state: event.state }),
      ...(event.code === undefined ? {} : { code: event.code }) }))
  return { rows, approvals, reviews, decisions }
}
