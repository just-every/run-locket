import { reportSnapshot } from './report-snapshot'
import { nextReport } from './report-schedule'
import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { auditSql, guardSql } from './commands'
import { roleSql } from './access'
import { sql, type Actor } from './model'
import { reportDefinition, reportHumans, type ReportRow } from './reports'
import { reportCsv, reportOutput, reportPdf } from './report-output'

async function recipient(env:Bindings,id:string):Promise<Actor|null>{
  const o=await env.DB.prepare(`SELECT id,display_name,email,version,${roleSql} AS locket_role FROM oa_operators WHERE id=? AND status='active'`).bind(id,id).first<any>()
  return o?{id:o.id,name:o.display_name,email:o.email,role:o.locket_role,sessionId:'',operatorVersion:o.version}:null
}
export async function runReports(env:Bindings,now:number){
  const db=env.DB
  const due=(await db.prepare('SELECT * FROM lk_reports WHERE enabled=1 AND next_at<=? ORDER BY next_at,id').bind(now).all<ReportRow>()).results
  for(const r of due){
    const creator=await recipient(env,r.created_by)
    if(!creator||!reportHumans.includes(creator.role)){await db.prepare('UPDATE lk_reports SET enabled=0,version=version+1 WHERE id=? AND version=?').bind(r.id,r.version).run();continue}
    for(const recipientId of JSON.parse(r.recipients) as string[]){
      const id=crypto.randomUUID()
      const inserted=await db.prepare("INSERT INTO lk_report_deliveries(id,report_id,due_at,recipient_id,status,created_at) VALUES(?,?,?,?,'preparing',?) ON CONFLICT DO NOTHING").bind(id,r.id,r.next_at,recipientId,now).run()
      if(!inserted.meta.changes)continue
      const finish=(status:string,detail:string|null=null,messageId:string|null=null)=>{
        const audit=auditSql({env,db,actor:creator,now,commandId:id},{action:`report.email.${status}`,summary:status==='accepted'?'Mail provider accepted a scoped scheduled report; mailbox delivery unconfirmed.':`Scheduled report outcome: ${status}.`},'scheduler')
        return db.batch([db.prepare('UPDATE lk_report_deliveries SET status=?,detail=?,provider_message_id=? WHERE id=?').bind(status,detail,messageId,id),db.prepare(audit.sql).bind(...audit.params)])
      }
      let sending=false
      try{
        const actor=await recipient(env,recipientId)
        if(!actor){await finish('cancelled','Recipient is inactive');continue}
        // The attachment contains a snapshot, guarded against access/record/role changes before dispatch.
        const versions=(await db.prepare('SELECT id,version FROM lk_agreements').all<{id:string;version:number}>()).results
        const out=await reportOutput(env,actor,reportDefinition(r),{deliveryId:id,reportId:r.id,reportVersion:r.version,now})
        const checks=[sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND version=?)",creator.id,creator.operatorVersion),sql(`${roleSql}=?`,creator.id,creator.role),sql("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND version=? AND email=?)",actor.id,actor.operatorVersion,actor.email),sql(`${roleSql}=?`,actor.id,actor.role),sql('EXISTS(SELECT 1 FROM lk_reports WHERE id=? AND version=? AND enabled=1)',r.id,r.version)]
        checks.push(reportSnapshot(actor,out.result.rows.map(row=>({id:row.id,version:versions.find(a=>a.id===row.id)!.version}))))
        const guard=crypto.randomUUID()
        await db.batch([guardSql(guard,checks),sql("UPDATE lk_report_deliveries SET status='sending' WHERE id=? AND status='preparing'",id),sql('DELETE FROM lk_guard WHERE id=?',guard)].map(s=>db.prepare(s.sql).bind(...s.params)))
        const sender=operatorMail(env)
        if(env.AUTH_LOCAL==='true'||(env as any).RER_DEMO==='1'){await finish('suppressed','Local/demo; no email sent');continue}
        if(!sender||!env.MAIL_FROM){await finish('rejected','Mail unavailable');continue}
        const content=r.format==='csv'?new TextEncoder().encode(reportCsv(out)):reportPdf(out)
        const message={deliveryId:id,from:env.MAIL_FROM,to:[actor.email],subject:'Your scheduled Locket report',text:'Your report is attached. It contains only agreements you could access when generated. Provider acceptance does not confirm mailbox delivery.',html:'<p>Your scoped Locket report is attached.</p>',headers:{},attachments:[{filename:`locket-report.${r.format}`,contentType:r.format==='csv'?'text/csv':'application/pdf',content,disposition:'attachment'}]}
        sending=true
        const sent=await sender.send(message)
        await finish(sent.status==='development'?'suppressed':sent.status,sent.code??null,sent.providerMessageId)
      }catch{await finish(sending?'uncertain':'failed',sending?'Provider outcome unknown; no automatic resend':'Generation or access check failed; no email was sent')}
    }
    await db.prepare('UPDATE lk_reports SET next_at=? WHERE id=? AND version=? AND next_at=?').bind(nextReport(r,now),r.id,r.version,r.next_at).run()
  }
}
