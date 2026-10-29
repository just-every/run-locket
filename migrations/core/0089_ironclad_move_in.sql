-- Session-bound read jobs retain the source and visible pending/failure state.
-- Private API tokens are never stored, returned or archived.
CREATE TABLE lk_ironclad_reads (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, session_id TEXT NOT NULL,
 label TEXT NOT NULL, origin TEXT NOT NULL, connection_digest TEXT NOT NULL,
 metadata TEXT NOT NULL, job_id TEXT, archive TEXT,
 status TEXT NOT NULL CHECK(status IN ('pending','ready','failed')),
 message TEXT, created_at INTEGER NOT NULL, checked_at INTEGER,
 version INTEGER NOT NULL DEFAULT 1
);

-- Imported USD values use the same cited proposal/confirmation history as dates.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE lk_terms_move_in (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 key TEXT NOT NULL CHECK(key IN ('effective_date','end_date','auto_renew','renewal_term_months','notice_days','governing_law','payment_terms','renewal_type','renewals_allowed','initial_term_months','value') OR key LIKE 'custom:%'),
 value TEXT NOT NULL, citation TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('proposed','confirmed','rejected','superseded')),
 proposed_by TEXT NOT NULL, proposal_id TEXT, confirmed_by TEXT, confirmed_at INTEGER,
 supersedes_id TEXT, reason TEXT, created_at INTEGER NOT NULL
);
INSERT INTO lk_terms_move_in SELECT * FROM lk_terms;
DROP TABLE lk_terms;
ALTER TABLE lk_terms_move_in RENAME TO lk_terms;
CREATE TABLE lk_move_in_migration_guard (ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO lk_move_in_migration_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM pragma_foreign_key_check) THEN 0 ELSE 1 END;
DROP TABLE lk_move_in_migration_guard;
PRAGMA defer_foreign_keys = OFF;
