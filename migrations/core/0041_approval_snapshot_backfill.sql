-- Existing native requests predate conditional rules. Preserve their original
-- no-rules route instead of allowing a later publication to reroute them.
INSERT INTO lk_approval_rule_snapshots(agreement_id,ruleset_id,captured_at)
SELECT a.id,NULL,a.created_at FROM lk_agreements a
WHERE a.origin='intake' AND NOT EXISTS(
 SELECT 1 FROM lk_approval_rule_snapshots s WHERE s.agreement_id=a.id
);
