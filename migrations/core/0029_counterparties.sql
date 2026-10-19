-- REPO-010: a counterparty's legal details, notice address and method, contacts
-- and authorized signatories (recorded, never validated), and merges: a merged
-- duplicate stays as history, pointing at the record it was merged into.
ALTER TABLE lk_parties ADD COLUMN entity_type TEXT;
ALTER TABLE lk_parties ADD COLUMN formation TEXT;
ALTER TABLE lk_parties ADD COLUMN registered_address TEXT;
ALTER TABLE lk_parties ADD COLUMN notice_address TEXT;
ALTER TABLE lk_parties ADD COLUMN notice_method TEXT CHECK(notice_method IS NULL OR notice_method IN ('email','post','courier','hand'));
ALTER TABLE lk_parties ADD COLUMN contacts TEXT NOT NULL DEFAULT '[]';
ALTER TABLE lk_parties ADD COLUMN signatories TEXT NOT NULL DEFAULT '[]';
ALTER TABLE lk_parties ADD COLUMN merged_into TEXT REFERENCES lk_parties(id);
ALTER TABLE lk_parties ADD COLUMN merged_by TEXT;
ALTER TABLE lk_parties ADD COLUMN merged_at INTEGER;
ALTER TABLE lk_parties ADD COLUMN merge_reason TEXT;
