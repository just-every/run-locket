-- AGENT-003: a person selects the source; preparation never authorizes sending.
CREATE TABLE lk_notice_sources (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL, renewal_id TEXT NOT NULL,
 version_id TEXT NOT NULL, quote TEXT NOT NULL, decision TEXT NOT NULL,
 deadline_at INTEGER NOT NULL, decided_at INTEGER NOT NULL, party_id TEXT NOT NULL,
 party_version INTEGER NOT NULL, recipient TEXT NOT NULL, alternate_address TEXT,
 selected_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE lk_notice_plans (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL, source_id TEXT NOT NULL,
 parent_notice_id TEXT, method TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
 send_local TEXT, timezone TEXT, send_at INTEGER, watch_at INTEGER,
 approved_by TEXT, operator_version INTEGER, agreement_version INTEGER,
 pdf_sha256 TEXT, recipient TEXT, alert_at INTEGER, acknowledged_at INTEGER,
 acknowledgment TEXT, outcome TEXT
);
