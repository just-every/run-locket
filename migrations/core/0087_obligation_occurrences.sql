-- Each recurrence is a retained obligation with its own evidence and reminder claims.
ALTER TABLE lk_obligations ADD COLUMN series_id TEXT;
ALTER TABLE lk_obligations ADD COLUMN recurrence_anchor TEXT;
ALTER TABLE lk_obligations ADD COLUMN occurrence_number INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lk_obligations ADD COLUMN resolution TEXT CHECK(resolution IS NULL OR resolution IN ('done','waived'));
ALTER TABLE lk_obligations ADD COLUMN waiver_reason TEXT;
CREATE UNIQUE INDEX lk_obligation_occurrence ON lk_obligations(series_id, occurrence_number) WHERE series_id IS NOT NULL;
