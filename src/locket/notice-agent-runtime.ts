// Durable hourly claims and delivery watches; no browser session is invented.
import type { Bindings } from '../auth.server'
import { may, roleSql, visibleSql } from './access'
import { auditSql, guardSql, type Ctx } from './commands'
import { agentDraft, sourceChecks } from './notice-agent'
import { dispatchNotice } from './notice-mail'
import { notificationBatch, notificationCheck, notificationWrites } from './notifications'
import { sql, type Actor } from './model'

async function actorFor(env: Bindings, id: string): Promise<Actor | null> {
  const row = await env.DB.prepare(`SELECT *,${roleSql} AS locket_role FROM oa_operators WHERE id=? AND status='active'`).bind(id,id).first<any>()
  return row ? { id, name: row.display_name, email: row.email, role: row.locket_role, sessionId: '', operatorVersion: row.version } : null
}
export async function runNoticeAgent(env: Bindings, now: number) {
  now = Math.max(now, Date.now())
  const db = env.DB
  const plans = (await db.prepare("SELECT * FROM lk_notice_plans WHERE status!='draft' ORDER BY send_at,id").all<any>()).results
  for (const plan of plans) {
    const source = await db.prepare('SELECT * FROM lk_notice_sources WHERE id=?').bind(plan.source_id).first<any>()
    const actor = await actorFor(env, plan.approved_by)
    const c: Ctx = {env,db,actor:actor ?? {id:plan.approved_by,name:'Notice scheduler',email:'',role:'viewer',sessionId:'',operatorVersion:0},now,commandId:plan.id}
    const checks = [...sourceChecks(source), visibleSql(c.actor,plan.agreement_id),
      sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND version=?)",plan.approved_by,plan.operator_version),
      sql(`${roleSql} IN ('owner','approver')`,plan.approved_by),
      sql('EXISTS(SELECT 1 FROM lk_agreements WHERE id=? AND version=? AND timezone=?)',plan.agreement_id,plan.agreement_version,plan.timezone),
      sql('EXISTS(SELECT 1 FROM lk_notice_letters WHERE id=? AND sha256=? AND recipient=?)',plan.id,plan.pdf_sha256,plan.recipient)]
    if (plan.status === 'scheduled' && plan.send_at <= now) {
      let status = 'ready', outcome = 'Approved manual method is due; record actual sending and tracking.'
      if (now >= source.deadline_at || !await notificationCheck(db,checks)) {status='cancelled';outcome='Authority, source or record changed, or deadline passed; no send.'}
      if (status === 'ready' && plan.method === 'email') {
        const guard = crypto.randomUUID()
        try {
          await notificationBatch(db,[guardSql(guard,[...checks,sql("(SELECT status FROM lk_notice_plans WHERE id=?)='scheduled'",plan.id),sql("(SELECT status FROM lk_notices WHERE id=?)='approved'",plan.id)]),
            sql("INSERT INTO lk_notice_dispatches(id,notice_id,agreement_id,agreement_version,actor_id,recipient,pdf_artifact_id,pdf_sha256,sender,subject,message_text,status,created_at) SELECT ?,?,?,?, ?,recipient,artifact_id,sha256,?,'Contract notice','Please find the approved notice letter attached.','queued',? FROM lk_notice_letters WHERE id=?",plan.id,plan.id,plan.agreement_id,plan.agreement_version,plan.approved_by,env.MAIL_FROM??'',now,plan.id),
            sql("UPDATE lk_notice_plans SET status='claimed',outcome='One-use email claim; inspect provider outcome.' WHERE id=?",plan.id),sql('DELETE FROM lk_guard WHERE id=?',guard)])
          await dispatchNotice(c,checks)
        } catch (error) {
          if (!/LOCKET_GUARD|UNIQUE constraint/.test(String(error))) throw error
        }
      } else {
        await notificationBatch(db,[sql("UPDATE lk_notice_plans SET status=?,outcome=? WHERE id=? AND status='scheduled'",status,outcome,plan.id),auditSql(c,{action:`notice.schedule.${status}`,agreementId:plan.agreement_id,summary:outcome},'scheduler')])
      }
    }
    // Signed failure triggers immediately; otherwise watch after one day, or an
    // hour before the deadline when sooner. Provider delivery is not acknowledgment.
    const events = (await db.prepare('SELECT status FROM lk_notice_events WHERE notice_id=?').bind(plan.id).all<any>()).results
    const failed = events.some(e=>['bounced','failed','complained'].includes(e.status))
    const acknowledged = await db.prepare('SELECT acknowledged_at,alert_at FROM lk_notice_plans WHERE id=?').bind(plan.id).first<any>()
    const dispatch = await db.prepare('SELECT status FROM lk_notice_dispatches WHERE notice_id=?').bind(plan.id).first<any>()
    const delivered = events.some(e=>e.status==='delivered')
    if (acknowledged.alert_at || (!failed && now < plan.watch_at) || (!failed && delivered && acknowledged.acknowledged_at)) continue
    const reason = failed ? 'Delivery failure reported' : dispatch?.status === 'uncertain' || dispatch?.status === 'sending' ? 'Email outcome uncertain; never automatically resend' : 'Delivery or recipient acknowledgment unconfirmed'
    const renewal = await db.prepare('SELECT decided_by FROM lk_renewals WHERE id=?').bind(source.renewal_id).first<any>()
    const writes = [sql('UPDATE lk_notice_plans SET alert_at=?,outcome=? WHERE id=?',now,reason,plan.id),auditSql(c,{action:'notice.watch.alert',agreementId:plan.agreement_id,summary:`${reason}; decision-maker alerted in the notice watch; counsel judges adequacy.`},'scheduler'),
      ...notificationWrites(c,{key:`notice-watch:${plan.id}`,agreementId:plan.agreement_id,recipientId:renewal.decided_by,kind:'deadline'})]
    // Only a fresh approved-source proposal, never a second send. Uncertain
    // email is not retried; a distinct courier draft requires another approval.
    if (!plan.parent_notice_id && actor && may.renewalDecision.includes(actor.role) && await notificationCheck(db,checks)) {
      const draft = await agentDraft(c,source,'courier',plan.id)
      writes.push(...draft.writes,auditSql(c,{action:'notice.agent.alternate',agreementId:plan.agreement_id,summary:'Prepared courier alternate to the recorded notice address; another exact human approval is required.'},'scheduler'))
    }
    const guard = crypto.randomUUID()
    try { await notificationBatch(db,[guardSql(guard,[sql('(SELECT alert_at FROM lk_notice_plans WHERE id=?) IS NULL',plan.id)]),...writes,sql('DELETE FROM lk_guard WHERE id=?',guard)]) }
    catch(error) {if(!/LOCKET_GUARD/.test(String(error)))throw error}
  }
}
