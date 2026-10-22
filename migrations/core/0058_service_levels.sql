CREATE TABLE lk_service_level_links (
 id TEXT PRIMARY KEY, agreement_id TEXT UNIQUE NOT NULL REFERENCES lk_agreements(id),
 origin TEXT NOT NULL, monitor_id TEXT NOT NULL, consent_by TEXT NOT NULL, consent_at INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, last_error TEXT
);
CREATE TABLE lk_service_level_terms (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), link_version INTEGER NOT NULL,
 source_agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), sources TEXT NOT NULL, citation TEXT NOT NULL,
 target_bps INTEGER NOT NULL CHECK(target_bps BETWEEN 1 AND 10000), tier_floor_bps INTEGER NOT NULL CHECK(tier_floor_bps BETWEEN 0 AND 9999),
 credit_bps INTEGER NOT NULL CHECK(credit_bps BETWEEN 1 AND 10000), monthly_cents INTEGER NOT NULL CHECK(monthly_cents>0),
 timezone TEXT NOT NULL, claim_days INTEGER NOT NULL CHECK(claim_days BETWEEN 1 AND 365),
 denominator_policy TEXT NOT NULL, interpretation TEXT NOT NULL, confirmed_by TEXT NOT NULL, confirmed_at INTEGER NOT NULL
);
CREATE TABLE lk_service_level_reads (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), term_id TEXT NOT NULL REFERENCES lk_service_level_terms(id),
 link_version INTEGER NOT NULL, sources TEXT NOT NULL, month TEXT NOT NULL, period_from INTEGER NOT NULL, period_to INTEGER NOT NULL,
 artifact_id TEXT NOT NULL REFERENCES lk_artifacts(id), response_sha256 TEXT NOT NULL, metrics TEXT NOT NULL, read_at INTEGER NOT NULL
);
CREATE TABLE lk_service_level_claims (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), read_id TEXT NOT NULL REFERENCES lk_service_level_reads(id),
 fingerprint TEXT UNIQUE NOT NULL, sources TEXT NOT NULL, monitor_id TEXT NOT NULL, month TEXT NOT NULL,
 amount_cents INTEGER NOT NULL, deadline_at INTEGER NOT NULL, deadline_date TEXT NOT NULL, content TEXT NOT NULL,
 owner_id TEXT NOT NULL, obligation_id TEXT NOT NULL REFERENCES lk_obligations(id),
 recipient TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL, message_text TEXT NOT NULL, message_digest TEXT,
 status TEXT NOT NULL CHECK(status IN ('proposed','approved')), version INTEGER NOT NULL DEFAULT 1,
 approved_by TEXT, approved_at INTEGER, approved_operator_version INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE lk_service_level_breaches (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), claim_id TEXT UNIQUE NOT NULL REFERENCES lk_service_level_claims(id),
 supplier_party_id TEXT NOT NULL REFERENCES lk_parties(id), obligation_id TEXT NOT NULL REFERENCES lk_obligations(id),
 read_id TEXT NOT NULL REFERENCES lk_service_level_reads(id), status TEXT NOT NULL CHECK(status='breached'),
 period_from INTEGER NOT NULL, period_to INTEGER NOT NULL, recorded_at INTEGER NOT NULL
);
CREATE TABLE lk_service_level_dispatches (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id), claim_id TEXT UNIQUE NOT NULL REFERENCES lk_service_level_claims(id),
 monitor_id TEXT NOT NULL, month TEXT NOT NULL, claim_version INTEGER NOT NULL, actor_id TEXT NOT NULL,
 recipient TEXT NOT NULL, sender TEXT NOT NULL, subject TEXT NOT NULL, message_text TEXT NOT NULL, message_digest TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','sending','accepted','rejected','uncertain','rate_limited','suppressed','cancelled')),
 attempt_id TEXT, attempted_at INTEGER, provider_message_id TEXT, outcome_code TEXT, created_at INTEGER NOT NULL,
 UNIQUE(agreement_id,monitor_id,month)
);
