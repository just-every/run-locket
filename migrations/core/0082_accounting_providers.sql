ALTER TABLE lk_accounting_links ADD COLUMN provider TEXT NOT NULL DEFAULT 'quickbooks';
ALTER TABLE lk_accounting_links ADD COLUMN record_kind TEXT NOT NULL DEFAULT 'vendor';
