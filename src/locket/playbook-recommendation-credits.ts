import type { Ctx } from './commands'
import { canonical, json, parse, Problem, sha256, sql, type Sql } from './model'
import { canReadServiceSources, servicePeople, servicePerson } from './service-level-records'

// Native records remain historical evidence even after authority or sources change.
// These selected columns cover immutable evidence and every mutable decision state.
const tables: Record<string, string[]> = {
  lk_reconciliation_findings: ['id','agreement_id','scan_id','content','version','status','finance_by','finance_at','finance_note','approved_by','approved_at','message_digest','rejected_at','rejection_reason','created_at'],
  lk_reconciliation_dispatches: ['id','agreement_id','finding_id','finding_version','status','attempted_at','provider_message_id','outcome_code'],
  lk_reconciliation_settings: ['agreement_id','version'],
  lk_reconciliation_interpretations: ['id','agreement_id','settings_version','sources','citation','confirmed_at'],
  lk_reconciliation_scans: ['id','agreement_id','interpretation_id','settings_version','link_version','sources','content','scanned_at'],
  lk_accounting_links: ['agreement_id','version'],
  lk_service_level_claims: ['id','agreement_id','read_id','sources','content','amount_cents','version','status','approved_by','approved_at','message_digest','deadline_at','created_at'],
  lk_service_level_dispatches: ['id','agreement_id','claim_id','claim_version','status','attempted_at','provider_message_id','outcome_code'],
  lk_service_level_links: ['agreement_id','version'],
  lk_service_level_terms: ['id','agreement_id','link_version','sources','citation','confirmed_at'],
  lk_service_level_reads: ['id','agreement_id','term_id','link_version','sources','artifact_id','response_sha256','month','read_at'],
  lk_service_performance_claims: ['id','agreement_id','read_id','sources','content','amount_cents','owner_id','version','status','approved_by','approved_at','approved_operator_version','message_digest','deadline_at','created_at'],
  lk_service_performance_reports: ['id','agreement_id','term_id','sources','month','artifact_id','response_sha256','metrics','source_kind','source_name','source_reference','window_note','connection','consent_by','consent_operator_version','read_at'],
  lk_service_performance_terms: ['id','agreement_id','metric','source_agreement_id','sources','citation','config','confirmed_by','confirmed_at'],
  lk_service_performance_dispatches: ['id','agreement_id','claim_id','claim_version','status','attempted_at','provider_message_id','outcome_code'],
}
const familyQuery = `WITH RECURSIVE family(id) AS (SELECT ? UNION SELECT a.id FROM lk_agreements a JOIN family f ON a.parent_id=f.id WHERE a.relation='amends')
 SELECT json_group_array(json_object('id',r.id,'version',r.version)) AS value FROM (SELECT a.id,a.version FROM lk_agreements a JOIN family f ON f.id=a.id ORDER BY a.id) r`
const authorityQuery = `SELECT json_group_array(json_object('id',o.id,'version',o.version,'status',o.status,'role',CASE WHEN o.role='owner' THEN 'owner' ELSE COALESCE(r.role,'viewer') END)) AS value FROM oa_operators o LEFT JOIN lk_roles r ON r.operator_id=o.id WHERE o.id IN (SELECT value FROM json_each(?)) ORDER BY o.id`
function snapshotQuery(table: string) {
  const columns = tables[table]
  return `SELECT json_group_array(json_object(${columns.map(k => `'${k}',r.${k}`).join(',')})) AS value FROM (SELECT * FROM ${table} WHERE agreement_id IN (SELECT value FROM json_each(?)) ORDER BY rowid) r`
}
export function creditSnapshotGuards(input: any): Sql[] {
  if (!input) return []
  return [...input.tables.map((entry: any) => sql(`(${snapshotQuery(entry.table)}) IS ?`, json(input.agreementIds), entry.value)),
    ...input.families.map((entry:any)=>sql(`(${familyQuery}) IS ?`,entry.agreementId,entry.value)),
    ...(input.authorityChecks ?? []), ...(input.authoritySnapshot ? [sql(`(${authorityQuery}) IS ?`, json(input.authorityIds), input.authoritySnapshot)] : [])]
}

/** Read native 001/002 evidence only for the selected cohort; never infer recovery
 * from message acceptance. Snapshots retain source identities and decision changes. */
export async function recommendationCredits(c: Ctx, outcomes: any[]) {
  const agreementIds = [...new Set(outcomes.map(o => o.agreement_id))].sort()
  const snapshots = await Promise.all(Object.keys(tables).map(async table => {
    const result = await c.db.prepare(snapshotQuery(table)).bind(json(agreementIds)).first<{value:string}>()
    return { table, value: result!.value }
  }))
  const rows = (table: string): any[] => parse(snapshots.find(s => s.table === table)!.value)
  const authorityChecks:Sql[]=[], authorityIds=new Set<string>(), connections:any[]=[]
  const evidence: any[] = [], families: {agreementId:string;value:string}[] = []
  for (const [kind, table, dispatchTable] of [
    ['potential_overcharge','lk_reconciliation_findings','lk_reconciliation_dispatches'],
    ['service_credit_claim','lk_service_level_claims','lk_service_level_dispatches'],
    ['performance_credit_claim','lk_service_performance_claims','lk_service_performance_dispatches'],
  ]) for (const record of rows(table)) {
    const outcome = outcomes.find(o => o.agreement_id === record.agreement_id)
    if (!outcome || record.created_at < outcome.recorded_at) continue
    const content = parse<any>(record.content), sources = kind === 'potential_overcharge' ? content.sources : parse<any[]>(record.sources)
    if (!await canReadServiceSources(c.db,c.actor,json(sources))) continue
    const citation = content.citation
    const version = await c.db.prepare('SELECT id,agreement_id,number,digest FROM lk_versions WHERE id=? AND agreement_id=?').bind(citation.versionId,content.sourceAgreementId).first<any>()
    if (!version) continue
    let family = families.find(f=>f.agreementId===record.agreement_id)
    if (!family) {
      const current=await c.db.prepare(familyQuery).bind(record.agreement_id).first<{value:string}>()
      family={agreementId:record.agreement_id,value:current!.value}; families.push(family)
    }
    let sourceChanged = canonical(parse(family.value)) !== canonical(sources), authorityChanged=false
    let reportEvidence:any=null
    if (kind === 'potential_overcharge') {
      const scan = rows('lk_reconciliation_scans').find(r => r.id === record.scan_id)
      sourceChanged ||= rows('lk_reconciliation_settings').find(r=>r.agreement_id===record.agreement_id)?.version !== scan?.settings_version
        || rows('lk_accounting_links').find(r=>r.agreement_id===record.agreement_id)?.version !== scan?.link_version
        || rows('lk_reconciliation_interpretations').filter(r=>r.agreement_id===record.agreement_id).at(-1)?.id !== scan?.interpretation_id
    } else if (kind === 'performance_credit_claim') {
      const report=rows('lk_service_performance_reports').find(r=>r.id===record.read_id),term=rows('lk_service_performance_terms').find(t=>t.id===report?.term_id)
      sourceChanged ||= !report||!term||rows('lk_service_performance_terms').filter(t=>t.agreement_id===record.agreement_id&&t.metric===term?.metric).at(-1)?.id!==term?.id
      if(report&&term){
        reportEvidence={id:report.id,termId:report.term_id,artifactId:report.artifact_id,responseSha256:report.response_sha256,sourceKind:report.source_kind,sourceName:report.source_name,sourceReference:report.source_reference,windowNote:report.window_note,month:report.month,consentBy:report.consent_by,consentOperatorVersion:report.consent_operator_version,readAt:report.read_at}
        const owner=await c.db.prepare('SELECT owner_id FROM lk_agreements WHERE id=?').bind(record.agreement_id).first<{owner_id:string}>()
        authorityChanged=owner?.owner_id!==record.owner_id||report.consent_by!==record.owner_id
        for(const [id,roles] of [[term.confirmed_by,['counsel']],[record.owner_id,servicePeople]] as const){
          authorityIds.add(id)
          try{const current=await servicePerson(c,id,[...roles],sources.map((s:any)=>s.id));authorityChecks.push(current.check);if(id===record.owner_id)authorityChanged ||= current.person.version!==report.consent_operator_version||(record.approved_by!==null&&current.person.version!==record.approved_operator_version)}catch(error){if(!(error instanceof Problem))throw error;authorityChanged=true}
        }
        if(record.approved_by)authorityIds.add(record.approved_by)
        if(report.source_kind==='linen'){const connection=parse<any>(report.connection),matches=Boolean(c.env.LINEN_MCP_TOKEN)&&connection.origin===c.env.LINEN_ORIGIN&&connection.credentialDigest===await sha256(c.env.LINEN_MCP_TOKEN!);sourceChanged ||= !matches;connections.push({reportId:report.id,current:matches})}
      }
    } else {
      const read = rows('lk_service_level_reads').find(r => r.id === record.read_id)
      sourceChanged ||= rows('lk_service_level_links').find(r=>r.agreement_id===record.agreement_id)?.version !== read?.link_version
        || rows('lk_service_level_terms').filter(r=>r.agreement_id===record.agreement_id).at(-1)?.id !== read?.term_id
    }
    const dispatch = rows(dispatchTable).find(d => (kind === 'potential_overcharge' ? d.finding_id : d.claim_id) === record.id)
    evidence.push({ id: record.id, kind: 'credit', nativeKind: kind, outcomeId: outcome.id, agreementId: record.agreement_id,
      negotiationVersionId: outcome.version_id, recordVersion: record.version, status: record.status, sourceChanged, ...(kind==='performance_credit_claim'?{authorityChanged,reportEvidence}:{}),
      amountCents: kind === 'potential_overcharge' ? content.atStakeCents : record.amount_cents,
      amountBasis: kind === 'potential_overcharge' ? 'Potential overcharge; not an established credit.' : 'Counsel-confirmed service-credit formula; recovery unconfirmed.',
      approvedBy: record.approved_by, approvedAt: record.approved_at, financeBy: record.finance_by ?? null,
      sources, citation: { ...citation, agreementId: version.agreement_id, version: version.number, digest: version.digest },
      evidence: `${content.citation.quote} · ${content.interpretation}`, sourceEvidence: content, dispatch: dispatch ?? null, recoveryStatus: 'unconfirmed', recorded_at: record.created_at,
      description: `${kind === 'potential_overcharge' ? 'Potential overcharge finding' : 'Service credit claim'} (${record.status}); credit recovery unconfirmed.`,
    })
  }
  const sourceIds = [...new Set(evidence.flatMap(e=>e.sources.map((s:any)=>s.id)))].sort()
  // Agreement versions cover retained stale source records as well as the cohort.
  const sources = await Promise.all(sourceIds.map(id=>c.db.prepare('SELECT id,version FROM lk_agreements WHERE id=?').bind(id).first<any>()))
  const authorityList=[...authorityIds].sort(), authoritySnapshot=(await c.db.prepare(authorityQuery).bind(json(authorityList)).first<{value:string}>())!.value
  return { evidence, input: { agreementIds, tables: snapshots, sources, families, authorityIds:authorityList, authoritySnapshot, authorityChecks, connections } }
}
