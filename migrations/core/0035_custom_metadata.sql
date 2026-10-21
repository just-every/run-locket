CREATE TABLE lk_custom_fields (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
 agreement_types TEXT NOT NULL, help_text TEXT NOT NULL, required_stages TEXT NOT NULL,
 edit_roles TEXT NOT NULL, options TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE lk_custom_values (
 agreement_id TEXT NOT NULL REFERENCES lk_agreements(id) ON DELETE CASCADE,
 field_id TEXT NOT NULL REFERENCES lk_custom_fields(id), value TEXT NOT NULL CHECK(json_valid(value)),
 updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(agreement_id,field_id)
);
CREATE TABLE lk_proposals_custom (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('intake','review','family','terms','renewal','custom_fields')),
 agreement_id TEXT, payload TEXT NOT NULL, evidence TEXT NOT NULL, assumptions TEXT NOT NULL,
 prepared_by TEXT NOT NULL, prepared_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
 decided_by TEXT, decided_at INTEGER, decision_reason TEXT, outcome TEXT
);
INSERT INTO lk_proposals_custom SELECT * FROM lk_proposals;
DROP TABLE lk_proposals;
ALTER TABLE lk_proposals_custom RENAME TO lk_proposals;
PRAGMA defer_foreign_keys = ON;
CREATE TABLE lk_terms_custom (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 key TEXT NOT NULL CHECK(key IN ('effective_date','end_date','auto_renew','renewal_term_months','notice_days','governing_law','payment_terms') OR key LIKE 'custom:%'),
 value TEXT NOT NULL, citation TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('proposed','confirmed','rejected','superseded')),
 proposed_by TEXT NOT NULL, proposal_id TEXT, confirmed_by TEXT, confirmed_at INTEGER,
 supersedes_id TEXT, reason TEXT, created_at INTEGER NOT NULL
);
INSERT INTO lk_terms_custom SELECT * FROM lk_terms;
DROP TABLE lk_terms;
ALTER TABLE lk_terms_custom RENAME TO lk_terms;
CREATE TABLE lk_custom_migration_guard (ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO lk_custom_migration_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM pragma_foreign_key_check) THEN 0 ELSE 1 END;
DROP TABLE lk_custom_migration_guard;
PRAGMA defer_foreign_keys = OFF;
-- This is the final atomic stage fence, including signing and execution doors.
CREATE TRIGGER lk_custom_stage BEFORE UPDATE OF status ON lk_agreements
WHEN NEW.status IN ('in_review','approved','out_for_signature','executed')
BEGIN
 SELECT CASE WHEN EXISTS (
  SELECT 1 FROM lk_custom_fields f, json_each(f.agreement_types) t, json_each(f.required_stages) s
  WHERE t.value=NEW.type AND
   CASE s.value WHEN 'draft' THEN 0 WHEN 'in_review' THEN 1 WHEN 'approved' THEN 2 WHEN 'out_for_signature' THEN 3 WHEN 'executed' THEN 4 END
   <= CASE NEW.status WHEN 'in_review' THEN 1 WHEN 'approved' THEN 2 WHEN 'out_for_signature' THEN 3 WHEN 'executed' THEN 4 END
   AND NOT EXISTS(SELECT 1 FROM lk_custom_values v WHERE v.agreement_id=NEW.id AND v.field_id=f.id AND v.value!='null')
 ) THEN RAISE(ABORT,'LOCKET_REQUIRED_FIELDS') END;
END;
