-- Owner-managed launch audiences for configurable intake forms. Membership is
-- separate from agreement access and grants no agreement-reading authority.
CREATE TABLE lk_intake_audiences (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('group','department')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1)
);
CREATE TABLE lk_intake_members (
 audience_id TEXT NOT NULL REFERENCES lk_intake_audiences(id) ON DELETE CASCADE,
 operator_id TEXT NOT NULL REFERENCES oa_operators(id),
 PRIMARY KEY(audience_id, operator_id)
);
CREATE INDEX lk_intake_members_operator ON lk_intake_members(operator_id, audience_id);
