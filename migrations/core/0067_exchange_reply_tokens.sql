-- Legacy reply addresses cease granting inbound authority; issue a fresh exchange.
ALTER TABLE lk_exchanges ADD COLUMN reply_token_hash TEXT;
CREATE UNIQUE INDEX lk_exchange_reply_token ON lk_exchanges(reply_token_hash);

CREATE TABLE lk_api_tokens (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
 operator_id TEXT NOT NULL, session_id TEXT NOT NULL, commands TEXT NOT NULL, reads TEXT NOT NULL,
 expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER
);
