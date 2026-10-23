-- Explicit privacy authority intersects current repository access.
CREATE TABLE lk_privacy_scopes (
 operator_id TEXT NOT NULL, party_id TEXT NOT NULL REFERENCES lk_parties(id),
 granted_by TEXT NOT NULL, granted_at INTEGER NOT NULL,
 PRIMARY KEY(operator_id,party_id)
);

CREATE TABLE lk_connection_health (
 id TEXT PRIMARY KEY, account TEXT NOT NULL, status TEXT NOT NULL,
 reason TEXT, checked_at INTEGER NOT NULL, last_success_at INTEGER,
 incident_id TEXT, alert_status TEXT, version INTEGER NOT NULL
);
