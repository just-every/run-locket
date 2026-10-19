CREATE TABLE lk_bulk_reminder_operations (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, payload TEXT NOT NULL,
 previews TEXT NOT NULL, previewed INTEGER NOT NULL, applied INTEGER NOT NULL,
 status TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 version INTEGER NOT NULL
);
