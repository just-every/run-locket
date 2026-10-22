// Imported contracts keep their custody after the working version enters draft.
// Only an importer’s explicit unsigned-draft declaration permits draft deletion.
export const retainedOriginalSql=(alias='a')=>`EXISTS(SELECT 1 FROM lk_artifacts original WHERE original.agreement_id=${alias}.id AND original.imported=1 AND COALESCE(json_extract(original.provenance,'$.draftStatus'),'')<>'stated unexecuted draft by importer')`
export const deletableDraftSql=(alias='a')=>`${alias}.status='draft' AND NOT ${retainedOriginalSql(alias)} AND NOT EXISTS(SELECT 1 FROM lk_executions e WHERE e.agreement_id=${alias}.id) AND NOT EXISTS(SELECT 1 FROM lk_agreements child WHERE child.parent_id=${alias}.id) AND NOT EXISTS(SELECT 1 FROM lk_legal_holds h WHERE h.agreement_id=${alias}.id AND h.active=1)`
