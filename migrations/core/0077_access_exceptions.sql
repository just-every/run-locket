-- Person exceptions only override repository group grants, never restricted custody.
CREATE TABLE lk_access_exceptions (
 id TEXT NOT NULL UNIQUE,
 agreement_id TEXT NOT NULL REFERENCES lk_agreements(id) ON DELETE CASCADE,
 operator_id TEXT NOT NULL REFERENCES oa_operators(id),
 reason TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 granted_by TEXT NOT NULL REFERENCES oa_operators(id),
 granted_at INTEGER NOT NULL,
 PRIMARY KEY(agreement_id,operator_id)
);

CREATE TABLE lk_privileged_notes (
 id TEXT PRIMARY KEY,
 agreement_id TEXT NOT NULL REFERENCES lk_agreements(id) ON DELETE CASCADE,
 body TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES oa_operators(id),
 created_at INTEGER NOT NULL
);
