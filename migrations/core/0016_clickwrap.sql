-- SIGN-004. Published text and captured acceptance evidence are append-only.
CREATE TABLE lk_clickwrap_terms (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('tos','dpa','partner')),
 site_origin TEXT NOT NULL, current_version_id TEXT NOT NULL, version INTEGER NOT NULL,
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE lk_clickwrap_versions (
 id TEXT PRIMARY KEY, terms_id TEXT NOT NULL REFERENCES lk_clickwrap_terms(id), number INTEGER NOT NULL,
 body TEXT NOT NULL, digest TEXT NOT NULL, require_reacceptance INTEGER NOT NULL CHECK(require_reacceptance IN (0,1)),
 published_by TEXT NOT NULL, published_at INTEGER NOT NULL, UNIQUE(terms_id,number)
);
CREATE TABLE lk_clickwrap_acceptances (
 id TEXT PRIMARY KEY, terms_id TEXT NOT NULL REFERENCES lk_clickwrap_terms(id), version_id TEXT NOT NULL REFERENCES lk_clickwrap_versions(id),
 digest TEXT NOT NULL, identity_kind TEXT NOT NULL CHECK(identity_kind IN ('base_session','site_asserted')),
 account_id TEXT NOT NULL, email TEXT NOT NULL, operator_id TEXT, site_origin TEXT NOT NULL,
 party_id TEXT REFERENCES lk_parties(id), accepted_at INTEGER NOT NULL, ip TEXT NOT NULL, user_agent TEXT NOT NULL,
 page_shown TEXT NOT NULL, source_page TEXT NOT NULL, nonce TEXT UNIQUE, imported INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX lk_clickwrap_identity ON lk_clickwrap_acceptances(identity_kind,site_origin,account_id,terms_id);
CREATE INDEX lk_clickwrap_party ON lk_clickwrap_acceptances(party_id);
CREATE TRIGGER lk_clickwrap_versions_immutable BEFORE UPDATE ON lk_clickwrap_versions BEGIN SELECT RAISE(ABORT,'Published terms are immutable'); END;
CREATE TRIGGER lk_clickwrap_versions_kept BEFORE DELETE ON lk_clickwrap_versions BEGIN SELECT RAISE(ABORT,'Published terms are immutable'); END;
CREATE TRIGGER lk_clickwrap_evidence_immutable BEFORE UPDATE ON lk_clickwrap_acceptances
 WHEN NEW.id<>OLD.id OR NEW.terms_id<>OLD.terms_id OR NEW.version_id<>OLD.version_id OR NEW.digest<>OLD.digest
 OR NEW.identity_kind<>OLD.identity_kind OR NEW.account_id<>OLD.account_id OR NEW.email<>OLD.email
 OR NEW.operator_id IS NOT OLD.operator_id OR NEW.site_origin<>OLD.site_origin OR NEW.accepted_at<>OLD.accepted_at
 OR NEW.ip<>OLD.ip OR NEW.user_agent<>OLD.user_agent OR NEW.page_shown<>OLD.page_shown OR NEW.source_page<>OLD.source_page
 OR NEW.nonce IS NOT OLD.nonce OR NEW.imported<>OLD.imported
 BEGIN SELECT RAISE(ABORT,'Acceptance evidence is immutable'); END;
CREATE TRIGGER lk_clickwrap_evidence_kept BEFORE DELETE ON lk_clickwrap_acceptances BEGIN SELECT RAISE(ABORT,'Acceptance evidence is immutable'); END;
