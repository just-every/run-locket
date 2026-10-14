-- Locket: agreements, versions, approvals, execution evidence, obligations and notices.
-- Every consequential write passes lk_guard inside the same D1 batch: the row's
-- CHECK fails the whole batch unless the current session, role and record
-- versions still hold.
CREATE TABLE lk_guard (id TEXT PRIMARY KEY, ok INTEGER NOT NULL CONSTRAINT LOCKET_GUARD CHECK(ok=1));

CREATE TABLE lk_commands (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, actor_id TEXT NOT NULL, digest TEXT NOT NULL,
 result TEXT NOT NULL, at INTEGER NOT NULL
);

CREATE TABLE lk_roles (
 operator_id TEXT PRIMARY KEY,
 role TEXT NOT NULL CHECK(role IN ('owner','counsel','approver','requester','viewer','agent')),
 updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE lk_parties (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('customer','supplier','partner','other')),
 abn TEXT, email TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX lk_parties_name ON lk_parties(lower(name));

CREATE TABLE lk_agreements (
 id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('customer','supplier','nda','amendment','order_form','other')),
 party_id TEXT NOT NULL REFERENCES lk_parties(id),
 value_cents INTEGER, currency TEXT NOT NULL DEFAULT 'AUD',
 owner_id TEXT NOT NULL, requester_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','in_review','approved','out_for_signature','executed','imported','cancelled')),
 restricted INTEGER NOT NULL DEFAULT 0 CHECK(restricted IN (0,1)),
 needed_by TEXT, start_date TEXT, timezone TEXT NOT NULL DEFAULT 'Australia/Sydney',
 parent_id TEXT REFERENCES lk_agreements(id), relation TEXT CHECK(relation IS NULL OR relation IN ('amends','order_under','schedule_to','renews')),
 origin TEXT NOT NULL CHECK(origin IN ('intake','legacy','docusign-archive')),
 current_version_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX lk_agreements_party ON lk_agreements(party_id);

CREATE TABLE lk_access (
 agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), operator_id TEXT NOT NULL,
 granted_by TEXT NOT NULL, granted_at INTEGER NOT NULL, PRIMARY KEY(agreement_id, operator_id)
);

CREATE TABLE lk_requirements (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), label TEXT NOT NULL,
 artifact_id TEXT, waived_reason TEXT, waived_by TEXT, created_at INTEGER NOT NULL
);

-- Binary artifacts keep their exact original bytes in ordered chunks.
CREATE TABLE lk_artifacts (
 id TEXT PRIMARY KEY, agreement_id TEXT REFERENCES lk_agreements(id), version_id TEXT,
 role TEXT NOT NULL CHECK(role IN ('original','rendition','attachment','signed','certificate','package','manifest','notice_evidence','import_source')),
 filename TEXT NOT NULL, media_type TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL,
 source_system TEXT, source_id TEXT, provenance TEXT NOT NULL, imported INTEGER NOT NULL DEFAULT 0,
 uploaded_by TEXT NOT NULL, uploaded_at INTEGER NOT NULL
);
CREATE INDEX lk_artifacts_agreement ON lk_artifacts(agreement_id);
CREATE INDEX lk_artifacts_sha ON lk_artifacts(sha256);
CREATE TABLE lk_artifact_chunks (
 artifact_id TEXT NOT NULL REFERENCES lk_artifacts(id), ordinal INTEGER NOT NULL, bytes BLOB NOT NULL,
 PRIMARY KEY(artifact_id, ordinal)
);

CREATE TABLE lk_versions (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), number INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('template','upload','counterparty','legacy','imported')),
 label TEXT NOT NULL, template_version_id TEXT, fields TEXT, text TEXT, text_source TEXT NOT NULL CHECK(text_source IN ('template','docx','person','none')),
 digest TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(agreement_id, number)
);

CREATE TABLE lk_comments (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), version_id TEXT NOT NULL REFERENCES lk_versions(id),
 author_id TEXT NOT NULL, body TEXT NOT NULL, quote TEXT, at INTEGER NOT NULL
);

CREATE TABLE lk_templates (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE lk_template_versions (
 id TEXT PRIMARY KEY, template_id TEXT NOT NULL REFERENCES lk_templates(id), number INTEGER NOT NULL,
 body TEXT NOT NULL, fields TEXT NOT NULL, clauses TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','approved','retired')),
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, approved_by TEXT, approved_at INTEGER,
 UNIQUE(template_id, number)
);

CREATE TABLE lk_playbook_versions (
 id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, rules TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','active','superseded')),
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, activated_by TEXT, activated_at INTEGER
);

CREATE TABLE lk_deviations (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), version_id TEXT NOT NULL REFERENCES lk_versions(id),
 playbook_version_id TEXT NOT NULL REFERENCES lk_playbook_versions(id), clause_key TEXT NOT NULL,
 result TEXT NOT NULL CHECK(result IN ('met','breached','undetermined')),
 start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL, quote TEXT NOT NULL,
 proposed_wording TEXT, explanation TEXT NOT NULL, questions TEXT NOT NULL, authority TEXT NOT NULL,
 proposal_id TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);

CREATE TABLE lk_approvals (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), version_id TEXT NOT NULL REFERENCES lk_versions(id),
 version_digest TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('commercial','exception')), deviation_id TEXT,
 decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')), actor_id TEXT NOT NULL, actor_role TEXT NOT NULL,
 context TEXT NOT NULL, context_digest TEXT NOT NULL, reason TEXT, at INTEGER NOT NULL,
 invalidated_at INTEGER, invalidated_reason TEXT
);

CREATE TABLE lk_packages (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), version_id TEXT NOT NULL,
 version_digest TEXT NOT NULL, pdf_artifact_id TEXT NOT NULL, manifest_artifact_id TEXT NOT NULL, manifest TEXT NOT NULL,
 provider TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('prepared','sent','completed','voided')),
 envelope_id TEXT, sent_by TEXT, sent_at INTEGER, void_reason TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);

CREATE TABLE lk_executions (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), package_id TEXT,
 provider TEXT NOT NULL, envelope_id TEXT, signed_artifact_id TEXT NOT NULL, certificate_artifact_id TEXT,
 signers TEXT NOT NULL, executed_on TEXT NOT NULL, imported INTEGER NOT NULL DEFAULT 0,
 checks TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('reconciled','needs_review','accepted')),
 resolution TEXT, resolved_by TEXT, recorded_by TEXT NOT NULL, recorded_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX lk_executions_envelope ON lk_executions(provider, envelope_id) WHERE envelope_id IS NOT NULL;

CREATE TABLE lk_terms (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 key TEXT NOT NULL CHECK(key IN ('effective_date','end_date','auto_renew','renewal_term_months','notice_days','governing_law','payment_terms')),
 value TEXT NOT NULL, citation TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('proposed','confirmed','rejected','superseded')),
 proposed_by TEXT NOT NULL, proposal_id TEXT, confirmed_by TEXT, confirmed_at INTEGER,
 supersedes_id TEXT, reason TEXT, created_at INTEGER NOT NULL
);

CREATE TABLE lk_obligations (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), description TEXT NOT NULL,
 owner_id TEXT NOT NULL, due_date TEXT, recurrence TEXT NOT NULL CHECK(recurrence IN ('none','monthly','quarterly','annually')),
 citation TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('proposed','confirmed','done','rejected')),
 created_by TEXT NOT NULL, confirmed_by TEXT, done_by TEXT, done_at INTEGER, created_at INTEGER NOT NULL
);

CREATE TABLE lk_renewals (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL UNIQUE REFERENCES lk_agreements(id),
 end_date TEXT NOT NULL, notice_days INTEGER NOT NULL, deadline_date TEXT NOT NULL, deadline_at INTEGER NOT NULL,
 timezone TEXT NOT NULL, auto_renew INTEGER NOT NULL,
 decision TEXT CHECK(decision IS NULL OR decision IN ('renew','renegotiate','terminate')),
 decided_by TEXT, decided_at INTEGER, decision_reason TEXT, updated_at INTEGER NOT NULL
);

CREATE TABLE lk_notices (
 id TEXT PRIMARY KEY, renewal_id TEXT NOT NULL REFERENCES lk_renewals(id), agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 recipient TEXT NOT NULL, body TEXT NOT NULL, prepared_by TEXT NOT NULL, proposal_id TEXT,
 status TEXT NOT NULL CHECK(status IN ('draft','approved','sent')),
 approved_by TEXT, approved_at INTEGER, sent_method TEXT, sent_at INTEGER, sent_recorded_by TEXT,
 evidence_artifact_id TEXT, created_at INTEGER NOT NULL
);

CREATE TABLE lk_proposals (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('intake','review','family','terms','renewal')),
 agreement_id TEXT, payload TEXT NOT NULL, evidence TEXT NOT NULL, assumptions TEXT NOT NULL,
 prepared_by TEXT NOT NULL, prepared_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
 decided_by TEXT, decided_at INTEGER, decision_reason TEXT, outcome TEXT
);

CREATE TABLE lk_import_batches (
 id TEXT PRIMARY KEY, kit TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('previewed','applied','undone')),
 source_label TEXT NOT NULL, preview TEXT NOT NULL, fingerprint TEXT NOT NULL, job_id TEXT,
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, applied_by TEXT, applied_at INTEGER,
 undone_by TEXT, undone_at INTEGER, undo_reason TEXT, version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE lk_audit (
 id TEXT PRIMARY KEY, at INTEGER NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, actor_role TEXT NOT NULL,
 action TEXT NOT NULL, agreement_id TEXT, summary TEXT NOT NULL, command_id TEXT
);
CREATE INDEX lk_audit_agreement ON lk_audit(agreement_id);

-- The import-kit revision each imported entity was applied at (src/locket/imports/adapter.ts).
CREATE TABLE lk_import_targets (kind TEXT NOT NULL, id TEXT NOT NULL, revision TEXT NOT NULL, PRIMARY KEY(kind, id));
