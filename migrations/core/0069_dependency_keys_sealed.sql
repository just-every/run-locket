-- Locket: Base dependencies change read by the refreshed src/modules/dependencies/store.mjs (keys_sealed, key_ids).
-- Verbatim Base 4280971d modules/dependencies/schema/keys-sealed.sql; new seeds get it as migrations/core/0016_sealing.sql.
ALTER TABLE rer_dependency_installation ADD COLUMN keys_sealed INTEGER NOT NULL DEFAULT 0 CHECK(keys_sealed IN (0,1));
-- Nonsecret version history lets restored rows name an unavailable retired key
-- without confusing ciphertext tampering or a wrong current secret with restore.
ALTER TABLE rer_dependency_installation ADD COLUMN key_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(key_ids) AND json_type(key_ids)='array');
