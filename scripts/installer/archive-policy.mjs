// One policy for local recovery and the hosted pre-update snapshot.
export default {
 includeTables: ['oa_operators','oa_bootstrap','oa_external_identities','oa_invitation_cancellations','oa_tokens','oa_auth_settings','oa_auth_audit','oa_domain_rules','oa_logout_events','oc_owner_claims','oc_idp_grants'],
 excludeTables: ['rer_dependency_keys','rer_dependency_pending','rer_dependency_codes','lk_guard','ik_d1_assertions'],
 secretColumns: {lk_calendar_connections:['token']},
 product: 'contracts-locket',
 requiredConfiguration: ['OWNER_EMAIL','SESSION_SECRET','SETUP_TOKEN','AUTH_ORIGIN','MAIL_PROVIDER','MAIL_FROM'],
};
