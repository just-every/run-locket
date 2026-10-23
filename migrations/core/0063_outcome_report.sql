ALTER TABLE lk_obligations ADD COLUMN responsible_side TEXT NOT NULL DEFAULT 'unclassified'
 CHECK(responsible_side IN ('ours','supplier','unclassified'));
CREATE TABLE lk_outcome_report_settings (
 id TEXT PRIMARY KEY CHECK(id='installation'), recipients TEXT NOT NULL, accounting_links TEXT NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), consent_by TEXT NOT NULL, consent_operator_version INTEGER NOT NULL,
 consent_at INTEGER NOT NULL, next_month TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE lk_outcome_report_deliveries (
 id TEXT PRIMARY KEY, month TEXT NOT NULL, recipient_id TEXT NOT NULL, settings_version INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','sending','accepted','rejected','uncertain','suppressed','cancelled')),
 attempt_id TEXT, attempted_at INTEGER, provider_message_id TEXT, created_at INTEGER NOT NULL,
 UNIQUE(month,recipient_id)
);
