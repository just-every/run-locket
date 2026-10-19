-- Expand relations while preserving all agreement identities and references.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE lk_agreements_next (
 id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('customer','supplier','nda','amendment','order_form','other')),
 party_id TEXT NOT NULL REFERENCES lk_parties(id),
 value_cents INTEGER, currency TEXT NOT NULL DEFAULT 'AUD',
 owner_id TEXT NOT NULL, requester_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','in_review','approved','out_for_signature','executed','imported','cancelled')),
 restricted INTEGER NOT NULL DEFAULT 0 CHECK(restricted IN (0,1)),
 needed_by TEXT, start_date TEXT, timezone TEXT NOT NULL DEFAULT 'Australia/Sydney',
 parent_id TEXT REFERENCES lk_agreements(id), relation TEXT CHECK(relation IS NULL OR relation IN ('amends','order_under','schedule_to','renews','statement_of_work_under','supersedes')),
 origin TEXT NOT NULL CHECK(origin IN ('intake','legacy','docusign-archive')),
 current_version_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO lk_agreements_next SELECT * FROM lk_agreements;
DROP TABLE lk_agreements;
ALTER TABLE lk_agreements_next RENAME TO lk_agreements;
CREATE INDEX lk_agreements_party ON lk_agreements(party_id);
CREATE TABLE lk_family_terms (
 root_id TEXT NOT NULL REFERENCES lk_agreements(id), key TEXT NOT NULL,
 term_id TEXT NOT NULL REFERENCES lk_terms(id), source_parent_id TEXT, source_relation TEXT,
 selected_by TEXT NOT NULL, selected_at INTEGER NOT NULL,
 PRIMARY KEY(root_id,key)
);
-- The drop/recreate leaves SQLite's deferred counter referring to the old
-- table. Assert the final graph before resetting that counter; normal FK
-- enforcement remains enabled throughout and after this transaction.
CREATE TABLE lk_family_migration_guard (ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO lk_family_migration_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM pragma_foreign_key_check) THEN 0 ELSE 1 END;
DROP TABLE lk_family_migration_guard;
PRAGMA defer_foreign_keys = OFF;
