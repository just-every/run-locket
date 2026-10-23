-- Packet documents/placements are approved together, before a provider sees them.
CREATE TABLE lk_signature_rule_drafts (
 id TEXT PRIMARY KEY CHECK(id='installation'), definition TEXT NOT NULL,
 fallback_id TEXT NOT NULL, version INTEGER NOT NULL, previewed_version INTEGER, published_id TEXT
);
CREATE TABLE lk_signature_rule_versions (
 id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, definition TEXT NOT NULL,
 fallback_id TEXT NOT NULL, published_by TEXT NOT NULL, published_at INTEGER NOT NULL
);
CREATE TABLE lk_signature_rule_snapshots (
 agreement_id TEXT PRIMARY KEY REFERENCES lk_agreements(id), ruleset_id TEXT REFERENCES lk_signature_rule_versions(id), captured_at INTEGER NOT NULL
);
-- Existing agreements freeze the absence of signer rules at this migration.
INSERT INTO lk_signature_rule_snapshots SELECT id,NULL,created_at FROM lk_agreements;
CREATE TABLE lk_signature_coordinators (
 type TEXT PRIMARY KEY, audience_id TEXT REFERENCES lk_intake_audiences(id), version INTEGER NOT NULL
);
CREATE TABLE lk_signature_template_blocks (
 template_version_id TEXT PRIMARY KEY REFERENCES lk_template_versions(id),
 definition TEXT NOT NULL, revision INTEGER NOT NULL, recorded_by TEXT NOT NULL, recorded_at INTEGER NOT NULL
);
CREATE TABLE lk_signature_packets (
 agreement_id TEXT PRIMARY KEY REFERENCES lk_agreements(id), version_id TEXT NOT NULL,
 revision INTEGER NOT NULL, ruleset_id TEXT REFERENCES lk_signature_rule_versions(id),
 documents TEXT NOT NULL, fields TEXT NOT NULL, recipients TEXT NOT NULL,
 updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE lk_signature_packet_changes (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 revision INTEGER NOT NULL, actor_id TEXT NOT NULL, at INTEGER NOT NULL, reason TEXT NOT NULL,
 definition TEXT NOT NULL
);
CREATE TABLE lk_signature_connections (
 provider TEXT PRIMARY KEY, base_url TEXT NOT NULL, account_id TEXT, version INTEGER NOT NULL,
 configured_by TEXT NOT NULL, configured_at INTEGER NOT NULL
);
CREATE TABLE lk_signature_tag_renditions (
 agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), provider TEXT NOT NULL,
 version_id TEXT NOT NULL, source_digest TEXT NOT NULL, definition TEXT NOT NULL,
 digest TEXT NOT NULL, prepared_at INTEGER NOT NULL, PRIMARY KEY(agreement_id,provider)
);
CREATE TABLE lk_signature_dispatches (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 package_id TEXT NOT NULL UNIQUE REFERENCES lk_packages(id), agreement_version INTEGER NOT NULL,
 actor_id TEXT NOT NULL, connection_version INTEGER NOT NULL, manifest_digest TEXT NOT NULL,
 status TEXT NOT NULL, attempt_id TEXT, attempted_at INTEGER, envelope_id TEXT, outcome_code TEXT,
 created_at INTEGER NOT NULL
);
-- Once a network call is claimed, retain its authorized snapshot until the
-- receipt is known. An interrupted claim remains visible and is never resent.
CREATE TRIGGER lk_signature_sending_snapshot BEFORE UPDATE ON lk_agreements
WHEN EXISTS(SELECT 1 FROM lk_signature_dispatches WHERE agreement_id=OLD.id AND status='sending')
BEGIN SELECT RAISE(ABORT,'LOCKET_GUARD signature provider operation in progress'); END;

CREATE TABLE lk_proposals_signing (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('intake','review','family','terms','renewal','custom_fields','signature')),
 agreement_id TEXT, payload TEXT NOT NULL, evidence TEXT NOT NULL, assumptions TEXT NOT NULL,
 prepared_by TEXT NOT NULL, prepared_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
 decided_by TEXT, decided_at INTEGER, decision_reason TEXT, outcome TEXT
);
INSERT INTO lk_proposals_signing SELECT * FROM lk_proposals;
DROP TABLE lk_proposals;
ALTER TABLE lk_proposals_signing RENAME TO lk_proposals;
