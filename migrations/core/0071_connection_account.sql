-- A read-only probe records the provider account it actually verified.
ALTER TABLE lk_connection_health ADD COLUMN provider_account TEXT;
