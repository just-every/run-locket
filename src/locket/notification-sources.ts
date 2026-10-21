import { routeRoleSql } from './intake-route'
// Compatibility with the existing approval and deadline outboxes. Their own
// one-use sender owns immediate delivery; only deferred originals enter here.
import { roleSql } from './access'
import { recipientGuard } from './approval-mail'
import { stillPendingSql } from './approval-reminders'
import type { Ctx } from './commands'
import { stillOpenSql } from './deadline-reminders'
import { decisionContext } from './review'
import type { AgreementRow, VersionRow } from './records'
import { sql, type Sql } from './model'
import type { NotificationRow, NotificationSource } from './notifications'

export const notificationSourceTables: Record<NotificationSource, string> = {
  approval_mail: 'lk_approval_mail', approval_reminder: 'lk_approval_reminders', deadline: 'lk_deadline_reminders',
}

export async function notificationSourceChecks(c: Ctx, event: NotificationRow): Promise<{ ready: boolean; checks: Sql[] }> {
  if (event.kind === 'queue_due_soon' || event.kind === 'queue_overdue' || event.kind === 'queue_assignment') return {ready:true,checks:[sql("EXISTS(SELECT 1 FROM lk_agreements WHERE id=? AND status IN ('draft','in_review','approved','out_for_signature'))",event.agreement_id)]}
  if (!event.source_kind) return { ready: true, checks: event.kind === 'approval' ? await pendingNotificationApproval(c, event) : [] }
  const table = notificationSourceTables[event.source_kind]
  const row = await c.db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(event.source_id).first<any>()
  // The old sender is still finishing the handoff. It must persist its honest
  // suppressed/daily_digest outcome before this dispatcher may claim delivery.
  if (row?.status === 'sending' || row?.status === 'queued') return { ready: false, checks: [] }
  if (!row || row.agreement_id !== event.agreement_id || row.recipient_id !== event.recipient_id)
    return { ready: true, checks: [sql('0')] }
  const checks = [sql(`EXISTS(SELECT 1 FROM ${table} WHERE id=? AND recipient_id=? AND agreement_id=? AND status='suppressed' AND code='daily_digest')`, row.id, event.recipient_id, event.agreement_id)]
  if (event.source_kind === 'approval_mail') {
    checks.push(sql(`EXISTS(SELECT 1 FROM lk_agreements a JOIN lk_versions v ON v.id=a.current_version_id
      WHERE a.id=? AND a.version=? AND a.status='in_review' AND v.id=? AND v.digest=?
      AND NOT EXISTS(SELECT 1 FROM lk_approvals x WHERE x.agreement_id=a.id AND x.version_id=v.id AND x.version_digest=v.digest AND x.kind='commercial' AND x.invalidated_at IS NULL))`,
    row.agreement_id, row.agreement_version, row.version_id, row.version_digest))
    checks.push(...recipientGuard(c, row.agreement_id, row.recipient_id, row.recipient_email))
  } else if (event.source_kind === 'approval_reminder') {
    checks.push(stillPendingSql({ agreementId: row.agreement_id, versionId: row.version_id, versionDigest: row.version_digest, approverId: row.approver_id }),
      ...recipientGuard(c, row.agreement_id, row.recipient_id, row.recipient_email))
  } else {
    checks.push(stillOpenSql(row.subject_kind, row.subject_id, row.deadline_date),
      sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND email=? AND status='active')", row.recipient_id, row.recipient_email))
  }
  return { ready: true, checks }
}

/** Guarded by ownership of the corresponding notification claim. A legacy
 * deadline digest stores its provider id once, on the real parent outbox row. */
export function notificationSourceOutcome(event: NotificationRow, status: string, provider: string | null, messageId: string | null, code: string | null, ownership: Sql, deadlineDigestId: string | null): Sql[] {
  if (!event.source_kind) return []
  const deadline = event.source_kind === 'deadline'
  return [sql(`UPDATE ${notificationSourceTables[event.source_kind]} SET status=?,provider=?,provider_message_id=?,code=?${deadline && deadlineDigestId ? ',digest_id=?' : ''}
    WHERE id=? AND status='suppressed' AND code='daily_digest' AND (${ownership.sql})`,
  deadline && deadlineDigestId && status === 'accepted' ? 'in_digest' : status, provider, deadline && deadlineDigestId ? null : messageId, code, ...(deadline && deadlineDigestId ? [deadlineDigestId] : []), event.source_id, ...ownership.params)]
}

/** Automatic approval events capture their business version at insertion. At
 * claim the recipient must still have an undecided part of the current route. */
async function pendingNotificationApproval(c: Ctx, event: NotificationRow): Promise<Sql[]> {
  if (!event.version_id || !event.version_digest) return [sql('0')]
  const agreement = await c.db.prepare('SELECT * FROM lk_agreements WHERE id=?').bind(event.agreement_id).first<AgreementRow>()
  const version = await c.db.prepare('SELECT * FROM lk_versions WHERE id=?').bind(event.version_id).first<VersionRow>()
  if (!agreement || !version) return [sql('0')]
  const { context, digest } = await decisionContext(c.db, agreement, version)
  // Bind repeated role expressions positionally; the SQL scalar always computes
  // the live role, including the native owner, rather than the event-time role.
  const role = roleSql
  return [sql(`EXISTS(SELECT 1 FROM lk_agreements a JOIN lk_versions v ON v.id=a.current_version_id
    WHERE a.id=? AND a.status='in_review' AND v.id=? AND v.digest=? AND a.value_cents IS ? AND a.party_id IS ?
    AND ((${role})='owner' OR a.requester_id<>?)
    AND (SELECT json_group_array(json_object('id',id,'result',result)) FROM
      (SELECT id,result FROM lk_deviations WHERE version_id=v.id AND result!='met' ORDER BY id))=?
    AND (
      ((${role}) IN ('owner',${routeRoleSql()}) AND NOT EXISTS(SELECT 1 FROM lk_approvals x
        WHERE x.agreement_id=a.id AND x.version_id=v.id AND x.version_digest=v.digest AND x.context_digest=?
          AND x.kind='commercial' AND x.invalidated_at IS NULL))
      OR EXISTS(SELECT 1 FROM lk_deviations d WHERE d.version_id=v.id AND d.result!='met'
        AND ((d.authority='counsel' AND (${role}) IN ('owner','counsel'))
          OR (d.authority<>'counsel' AND (${role}) IN ('owner','approver')))
        AND NOT EXISTS(SELECT 1 FROM lk_approvals x WHERE x.agreement_id=a.id AND x.version_id=v.id AND x.version_digest=v.digest
          AND x.context_digest=? AND x.kind='exception' AND x.deviation_id=d.id AND x.invalidated_at IS NULL))
    ))`, event.agreement_id, event.version_id, event.version_digest, context.valueCents, context.partyId,
  event.recipient_id, event.recipient_id, JSON.stringify(context.deviations), event.recipient_id, digest,
  event.recipient_id, event.recipient_id, digest)]
}
