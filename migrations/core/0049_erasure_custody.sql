-- A private random installation key survives rotation of sign-in credentials.
-- This table is excluded from workspace state and kept in owner archives.
CREATE TABLE lk_erasure_keys (
 id TEXT PRIMARY KEY CHECK(id='installation'), key_hex TEXT NOT NULL
);
-- The first erasure generates its key with Web Crypto, never SQLite’s PRNG.
