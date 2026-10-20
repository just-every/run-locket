-- NEG-004: replies remain on their root's immutable document version.
ALTER TABLE lk_comments ADD COLUMN parent_id TEXT REFERENCES lk_comments(id);
ALTER TABLE lk_comments ADD COLUMN resolved_by TEXT;
ALTER TABLE lk_comments ADD COLUMN resolved_at INTEGER;
ALTER TABLE lk_comments ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
CREATE INDEX lk_comment_replies ON lk_comments(parent_id, at);
