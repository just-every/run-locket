ALTER TABLE lk_connection_expiries ADD COLUMN source TEXT NOT NULL DEFAULT 'owner' CHECK(source IN ('owner','provider'));
