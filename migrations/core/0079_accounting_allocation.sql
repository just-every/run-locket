CREATE TABLE lk_accounting_reads (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 agreement_version INTEGER NOT NULL, link_version INTEGER NOT NULL, realm_id TEXT NOT NULL,
 content TEXT NOT NULL, read_by TEXT NOT NULL, read_at INTEGER NOT NULL
);
CREATE TABLE lk_accounting_allocations (
 id TEXT PRIMARY KEY, agreement_id TEXT NOT NULL REFERENCES lk_agreements(id),
 read_id TEXT NOT NULL REFERENCES lk_accounting_reads(id), bill_id TEXT NOT NULL,
 realm_id TEXT NOT NULL, vendor_id TEXT NOT NULL, amount_cents INTEGER NOT NULL,
 active INTEGER NOT NULL, agreement_version INTEGER NOT NULL,
 confirmed_by TEXT NOT NULL, confirmed_at INTEGER NOT NULL
);
