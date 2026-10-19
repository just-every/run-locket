-- Definitions confer no agreement access. Pins belong to the individual reader.
CREATE TABLE lk_saved_views (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 definition TEXT NOT NULL CHECK(json_valid(definition)),
 shared_roles TEXT NOT NULL CHECK(json_valid(shared_roles)),
 version INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX lk_saved_views_creator ON lk_saved_views(created_by);
CREATE TABLE lk_view_pins (
 view_id TEXT NOT NULL REFERENCES lk_saved_views(id) ON DELETE CASCADE,
 operator_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(view_id, operator_id)
);
