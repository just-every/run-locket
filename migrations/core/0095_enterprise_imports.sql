-- Keep imported amounts and currencies proposed until a person checks the signed source.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE lk_terms_enterprise (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 key TEXT NOT NULL CHECK(key IN ('effective_date','end_date','auto_renew','renewal_term_months','notice_days','governing_law','payment_terms','renewal_type','renewals_allowed','initial_term_months','value','import:value','import:currency') OR key LIKE 'custom:%'),
 value TEXT NOT NULL, citation TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('proposed','confirmed','rejected','superseded')),
 proposed_by TEXT NOT NULL, proposal_id TEXT, confirmed_by TEXT, confirmed_at INTEGER,
 supersedes_id TEXT, reason TEXT, created_at INTEGER NOT NULL
);
INSERT INTO lk_terms_enterprise SELECT * FROM lk_terms;
DROP TABLE lk_terms;
ALTER TABLE lk_terms_enterprise RENAME TO lk_terms;
PRAGMA defer_foreign_keys = OFF;
