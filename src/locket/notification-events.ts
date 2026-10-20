// Current business doors emit notifications in their own guarded write batch.
import type { Ctx, Outcome } from './commands'
import { notificationWrites } from './notifications'
import type { AgreementRow } from './records'
import type { Sql } from './model'

export async function approvalNotifications(c: Ctx, a: AgreementRow, roles: string[], key: string): Promise<Sql[]> {
  const people = (await c.db.prepare(`SELECT o.id FROM oa_operators o LEFT JOIN lk_roles r ON r.operator_id=o.id
    WHERE o.status='active' AND (CASE WHEN o.role='owner' THEN 'owner' ELSE COALESCE(r.role,'viewer') END) IN (SELECT value FROM json_each(?)) AND (o.role='owner' OR o.id<>?)`).bind(JSON.stringify(roles),a.requester_id).all<{id:string}>()).results
  return people.flatMap(person=>notificationWrites(c,{key,agreementId:a.id,recipientId:person.id,kind:'approval'}))
}

export async function commandNotifications(c: Ctx, type: string, p: Record<string, unknown>, out: Outcome): Promise<Sql[]> {
  const result = out.result as Record<string, any>
  if (!(['package.sent','package.void'].includes(type) || (type === 'execution.record' && result.status === 'reconciled') || type === 'execution.resolve')) return []
  const id=p.agreementId
  if (typeof id !== 'string') return []
  const a = await c.db.prepare('SELECT owner_id,requester_id FROM lk_agreements WHERE id=?').bind(id).first<{owner_id:string;requester_id:string}>()
  return a ? [...new Set([a.owner_id,a.requester_id])].flatMap(recipientId=>notificationWrites(c,{key:c.commandId,agreementId:id,recipientId,kind:'signature'})) : []
}
