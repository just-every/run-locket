CREATE TABLE lk_repository_policy (
 id TEXT PRIMARY KEY CHECK(id='installation'), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 grants TEXT NOT NULL, hidden_fields TEXT NOT NULL, version INTEGER NOT NULL
);
CREATE TABLE lk_agreement_departments (
 agreement_id TEXT PRIMARY KEY REFERENCES lk_agreements(id), department_id TEXT NOT NULL REFERENCES lk_intake_audiences(id)
);
CREATE TABLE lk_view_groups (
 view_id TEXT NOT NULL REFERENCES lk_saved_views(id), audience_id TEXT NOT NULL REFERENCES lk_intake_audiences(id),
 PRIMARY KEY(view_id,audience_id)
);
