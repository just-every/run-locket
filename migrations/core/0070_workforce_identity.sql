-- Workforce provisioning is an explicit installation-owner grant.
CREATE TABLE lk_workforce_settings (
 id TEXT PRIMARY KEY CHECK(id='installation'), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 version INTEGER NOT NULL, approved_by TEXT NOT NULL REFERENCES oa_operators(id), owner_version INTEGER NOT NULL
);
CREATE TABLE lk_workforce_groups (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('counsel','approver','requester','viewer')),
 audience_id TEXT NOT NULL UNIQUE REFERENCES lk_intake_audiences(id)
);
CREATE TABLE lk_workforce_users (
 id TEXT PRIMARY KEY REFERENCES oa_operators(id), subject TEXT NOT NULL UNIQUE, version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE lk_workforce_members (
 group_id TEXT NOT NULL REFERENCES lk_workforce_groups(id), operator_id TEXT NOT NULL REFERENCES lk_workforce_users(id),
 PRIMARY KEY(group_id,operator_id)
);
CREATE TABLE lk_saml_requests (
 id TEXT PRIMARY KEY, instant TEXT NOT NULL, browser_hash TEXT NOT NULL, configuration TEXT NOT NULL,
 ip_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER
);
