CREATE TABLE lk_service_performance_terms (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), metric TEXT NOT NULL CHECK(metric IN ('response','resolution','delivery')),
 source_agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), sources TEXT NOT NULL, citation TEXT NOT NULL, config TEXT NOT NULL,
 confirmed_by TEXT NOT NULL, confirmed_at INTEGER NOT NULL
);
CREATE TABLE lk_service_performance_reports (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), term_id TEXT NOT NULL REFERENCES lk_service_performance_terms(id),
 sources TEXT NOT NULL, month TEXT NOT NULL, period_from INTEGER NOT NULL, period_to INTEGER NOT NULL,
 artifact_id TEXT NOT NULL REFERENCES lk_artifacts(id), response_sha256 TEXT NOT NULL, metrics TEXT NOT NULL,
 source_kind TEXT NOT NULL CHECK(source_kind IN ('supplier_report','linen')), source_name TEXT NOT NULL, source_reference TEXT NOT NULL, window_note TEXT NOT NULL,
 connection TEXT NOT NULL DEFAULT '{}', consent_by TEXT NOT NULL, consent_operator_version INTEGER NOT NULL, read_at INTEGER NOT NULL
);
CREATE TABLE lk_service_performance_claims (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), read_id TEXT NOT NULL REFERENCES lk_service_performance_reports(id),
 fingerprint TEXT UNIQUE NOT NULL, sources TEXT NOT NULL, monitor_id TEXT NOT NULL, month TEXT NOT NULL,
 amount_cents INTEGER NOT NULL, deadline_at INTEGER NOT NULL, deadline_date TEXT NOT NULL, content TEXT NOT NULL,
 owner_id TEXT NOT NULL, obligation_id TEXT NOT NULL REFERENCES lk_obligations(id), recipient TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL, message_text TEXT NOT NULL,
 message_digest TEXT, status TEXT NOT NULL CHECK(status IN ('proposed','approved')), version INTEGER NOT NULL DEFAULT 1,
 approved_by TEXT, approved_at INTEGER, approved_operator_version INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE lk_service_performance_breaches (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), claim_id TEXT UNIQUE NOT NULL REFERENCES lk_service_performance_claims(id),
 supplier_party_id TEXT NOT NULL REFERENCES lk_parties(id), obligation_id TEXT NOT NULL REFERENCES lk_obligations(id), read_id TEXT NOT NULL REFERENCES lk_service_performance_reports(id),
 status TEXT NOT NULL CHECK(status='breached'), period_from INTEGER NOT NULL, period_to INTEGER NOT NULL, recorded_at INTEGER NOT NULL
);
CREATE TABLE lk_service_performance_dispatches (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), claim_id TEXT UNIQUE NOT NULL REFERENCES lk_service_performance_claims(id),
 monitor_id TEXT NOT NULL, month TEXT NOT NULL, claim_version INTEGER NOT NULL, actor_id TEXT NOT NULL, recipient TEXT NOT NULL, sender TEXT NOT NULL,
 subject TEXT NOT NULL, message_text TEXT NOT NULL, message_digest TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','sending','accepted','rejected','uncertain','rate_limited','suppressed','cancelled')),
 attempt_id TEXT, attempted_at INTEGER, provider_message_id TEXT, outcome_code TEXT, created_at INTEGER NOT NULL, UNIQUE(agreement_id,monitor_id,month)
);
