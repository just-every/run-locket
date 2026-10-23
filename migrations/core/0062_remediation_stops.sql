ALTER TABLE lk_remediation_requests ADD COLUMN stopped_at INTEGER;
ALTER TABLE lk_remediation_requests ADD COLUMN stop_kind TEXT;
ALTER TABLE lk_remediation_requests ADD COLUMN stop_reference TEXT;
