-- US-001: the installation's US time zone and business-day option, counterparty
-- tax IDs (EIN or foreign) and agreements recorded in another currency.
CREATE TABLE lk_installation_settings (
 id TEXT PRIMARY KEY CHECK(id='installation'),
 timezone TEXT NOT NULL,
 roll_notice_deadlines INTEGER NOT NULL CHECK(roll_notice_deadlines IN (0,1)),
 updated_by TEXT NOT NULL,
 updated_at INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1
);
ALTER TABLE lk_parties RENAME COLUMN abn TO tax_id;
ALTER TABLE lk_parties ADD COLUMN tax_id_kind TEXT CHECK(tax_id_kind IS NULL OR tax_id_kind IN ('ein','foreign'));
-- A tax number recorded before (an ABN) is kept as given, labeled foreign.
UPDATE lk_parties SET tax_id_kind='foreign' WHERE tax_id IS NOT NULL;
-- value_cents stays the USD amount every rule, filter and total reads; an agreement
-- in another currency also keeps its original amount and the recorded rate.
ALTER TABLE lk_agreements ADD COLUMN original_cents INTEGER;
ALTER TABLE lk_agreements ADD COLUMN usd_rate TEXT;
ALTER TABLE lk_agreements ADD COLUMN rate_recorded_by TEXT;
ALTER TABLE lk_agreements ADD COLUMN rate_recorded_at INTEGER;
