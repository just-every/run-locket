-- Legacy reply addresses cease granting inbound authority; issue a fresh exchange.
ALTER TABLE lk_exchanges ADD COLUMN reply_token_hash TEXT;
CREATE UNIQUE INDEX lk_exchange_reply_token ON lk_exchanges(reply_token_hash);
