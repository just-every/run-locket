-- Scheduled runs and routine polls read rows in proportion to what is open, never to how much
-- history is kept: Workers Free allows 5 million D1 rows read a day for the whole account.
-- Indexes match the queries the hourly and minute Cron runs issue; partial indexes cover only
-- the rows a run can still act on, so finished work (sent, accepted, closed) costs nothing.
CREATE INDEX lk_terms_agreement ON lk_terms(agreement_id,status);
CREATE INDEX lk_notices_agreement ON lk_notices(agreement_id);
CREATE INDEX lk_agreements_status ON lk_agreements(status);
CREATE INDEX lk_obligations_open ON lk_obligations(status,due_date);
CREATE INDEX lk_renewals_deadline ON lk_renewals(deadline_at);
CREATE INDEX lk_approvals_agreement ON lk_approvals(agreement_id,kind,at);
CREATE INDEX lk_approval_mail_agreement ON lk_approval_mail(agreement_id);
CREATE INDEX lk_notice_events_notice ON lk_notice_events(notice_id);
CREATE INDEX lk_renewal_briefs_agreement ON lk_renewal_briefs(agreement_id);
CREATE INDEX lk_deadline_reminders_subject ON lk_deadline_reminders(subject_id);
CREATE INDEX lk_executions_package ON lk_executions(package_id,status);
CREATE INDEX lk_pdf_renditions_version ON lk_pdf_renditions(version_id);
CREATE INDEX lk_rule_reminder_events_pending ON lk_rule_reminder_events(pending_id);

CREATE INDEX lk_execution_followups_waiting ON lk_execution_followups(created_at) WHERE status='waiting';
CREATE INDEX lk_rule_pending_active ON lk_rule_pending(agreement_id) WHERE active=1;
CREATE INDEX lk_approval_channel_deliveries_queued ON lk_approval_channel_deliveries(id) WHERE status='queued';
CREATE INDEX lk_outcome_report_deliveries_queued ON lk_outcome_report_deliveries(created_at,id) WHERE status='queued';
CREATE INDEX lk_notice_plans_open ON lk_notice_plans(send_at,id) WHERE status!='draft' AND (alert_at IS NULL OR status='scheduled');
CREATE INDEX lk_request_work_team ON lk_request_work(warning_at) WHERE team_id IS NOT NULL;
CREATE INDEX lk_reports_due ON lk_reports(next_at,id) WHERE enabled=1;

-- When each agreement's renewal lifecycle was last reconciled. The hourly run reconciles an
-- agreement that changed since, or has not been checked for a day, and no other.
CREATE TABLE lk_renewal_checks (
 agreement_id TEXT PRIMARY KEY REFERENCES lk_agreements(id) ON DELETE CASCADE,
 checked_at INTEGER NOT NULL
);
CREATE INDEX lk_renewal_checks_due ON lk_renewal_checks(checked_at);
CREATE INDEX lk_notifications_pending ON lk_notifications(created_at,id) WHERE email_status IN ('pending','immediate','digest') AND delivery_id IS NULL;
