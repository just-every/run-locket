-- Ct 22 Oct: exact request previews, random identities and explicit custody receipts.
ALTER TABLE lk_erasures RENAME COLUMN subject_hash TO subject_token;
UPDATE lk_erasures SET subject_token=lower(hex(randomblob(16))),reason='legacy_verified_request',verification='legacy_verified_request';
ALTER TABLE lk_erasures ADD COLUMN received_on TEXT;
ALTER TABLE lk_erasures ADD COLUMN receipt TEXT NOT NULL DEFAULT '{}';
ALTER TABLE lk_legal_holds ADD COLUMN review_on TEXT;
CREATE TABLE lk_erasure_previews (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, subject_token TEXT NOT NULL,
 fingerprint TEXT NOT NULL, reason TEXT NOT NULL, method TEXT NOT NULL, received_on TEXT NOT NULL,
 created_at INTEGER NOT NULL, applied_at INTEGER
);
-- Re-entry prevention retains only an encrypted address, never its unsalted digest.
CREATE TABLE lk_erasure_blocks (
 subject_token TEXT PRIMARY KEY, address_ciphertext TEXT NOT NULL, created_at INTEGER NOT NULL
);
