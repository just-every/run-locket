-- ENTITY-001: the business's own contracting entities. An agreement, template
-- or clause scoped to an entity names it; NULL on a template means every entity,
-- and on an agreement means the entity is not recorded yet.
CREATE TABLE lk_entities (
 id TEXT PRIMARY KEY,
 legal_name TEXT NOT NULL,
 entity_type TEXT NOT NULL,
 formation TEXT NOT NULL,
 tax_id_kind TEXT CHECK(tax_id_kind IS NULL OR tax_id_kind IN ('ein','foreign')),
 tax_id TEXT,
 registered_address TEXT NOT NULL,
 notice_address TEXT NOT NULL,
 currency TEXT NOT NULL,
 timezone TEXT NOT NULL,
 signatories TEXT NOT NULL,
 created_by TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX lk_entities_name ON lk_entities(lower(legal_name));
ALTER TABLE lk_agreements ADD COLUMN entity_id TEXT REFERENCES lk_entities(id);
ALTER TABLE lk_templates ADD COLUMN entity_id TEXT REFERENCES lk_entities(id);
