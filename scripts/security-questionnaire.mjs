import { readFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { readBuildConnectors } from '../security/build-connectors.mjs'

const root = new URL('../', import.meta.url)
const load = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'))
const documents = {
 caiqIndex: load('security/caiq-source-index.json'), caiq: load('security/caiq-responses.json'),
 sigIndex: load('security/sig-lite-source-index.json'), sig: load('security/sig-lite-responses.json'),
 profiles: load('security/response-profiles.json'),
}
const internalBindings = new Set([
 'DB', 'ASSETS', 'OWNER_EMAIL', 'SESSION_SECRET', 'SETUP_TOKEN', 'CLICKWRAP_SIGNING_KEY',
 'AUTH_ORIGIN', 'AUTH_LOCAL', 'RER_DEMO', 'RER_DEV_ORIGIN', 'RER_DEV_KEY', 'RER_DEV_IDENTITY',
 'RER_OWNER_CLAIM_INSTALLATION_ID', 'RER_INSTALLATION_ID', 'RER_MANAGEMENT_ORIGIN',
 'RER_DEPLOY_SOURCE', 'RER_DEPLOY_FINGERPRINT', 'RER_VERSION',
])
const nonempty = value => typeof value === 'string' && value.trim().length > 0

function checkMappings(label, index, mapping, profiles, answers, errors) {
 const expected = new Set(index.questionIds ?? []), seen = new Set()
 if (!expected.size || expected.size !== index.questionCount || expected.size !== index.questionIds.length) errors.push('Invalid source question index: ' + label)
 for (const question of mapping.questions ?? []) {
  if (!expected.has(question.id)) errors.push('Unknown question identifier: ' + label + ' ' + question.id)
  if (seen.has(question.id)) errors.push('Duplicate question response: ' + label + ' ' + question.id)
  seen.add(question.id)
  const response = profiles[question.response]
  if (!response) { errors.push('Missing response profile: ' + question.id); continue }
  if (!['Yes', 'No', 'Not applicable', 'Not assessed'].includes(response.answer)) errors.push('Invalid answer: ' + question.id)
  for (const field of ['software', 'buyer', 'platform']) if (!nonempty(response[field])) errors.push('Missing responsibility: ' + question.id + ' ' + field)
  if (!response.domains?.length || response.domains.some(domain => !nonempty(answers[domain]))) errors.push('Unanswered mapped domain: ' + question.id)
  if (!response.evidence?.length || response.evidence.some(path => !existsSync(new URL(path, root)))) errors.push('Missing response evidence: ' + question.id)
 }
 for (const id of expected) if (!seen.has(id)) errors.push('Unmapped question: ' + label + ' ' + id)
}

export function checkQuestionnaire(deploy, questionnaire, context = {}) {
 const { caiqIndex, caiq, sigIndex, sig, profiles } = { ...documents, ...context }
 const build = context.build ?? readBuildConnectors()
 const errors = [...(build.errors ?? [])], processors = questionnaire.subprocessors ?? []
 const bindings = new Set(processors.flatMap(processor => processor.bindings ?? []))
 const connectors = new Set(processors.flatMap(processor => processor.connectors ?? []))
 const deployed = ['secrets', 'd1', 'r2', 'services', 'kv', 'queues'].flatMap(kind => deploy[kind] ?? []).map(entry => entry.binding)
 for (const binding of new Set([...deployed, ...Object.keys(deploy.vars ?? {}), ...(build.bindings ?? [])])) {
  if (binding && !internalBindings.has(binding) && !bindings.has(binding)) errors.push('Unlisted build connector binding: ' + binding)
 }
 for (const connector of build.connectors ?? []) if (!connectors.has(connector)) errors.push('Unlisted build connector: ' + connector)
 for (const processor of processors) {
  if (![processor.name, processor.data, processor.configuration, processor.responsibility].every(nonempty)) errors.push('Incomplete processor disclosure: ' + processor.name)
 }
 for (const domain of ['dataFlows', 'encryption', 'access', 'audit', 'backup', 'incident', 'vulnerabilities', 'responsibility', 'assurance']) {
  if (!nonempty(questionnaire.answers?.[domain])) errors.push('Unanswered security domain: ' + domain)
 }
 for (const set of ['SIG Lite', 'CAIQ']) if (!nonempty(questionnaire.questionSets?.[set]?.responses)) errors.push('Missing question-set response index: ' + set)
 if (questionnaire.questionSets?.CAIQ?.version !== caiqIndex.version || caiq.version !== caiqIndex.version) errors.push('CAIQ source and response versions differ.')
 if (questionnaire.questionSets?.CAIQ?.status !== 'complete-id-mapping' || caiq.status !== 'complete-id-mapping') errors.push('CAIQ mapping is incomplete.')
 checkMappings('CAIQ', caiqIndex, caiq, profiles, questionnaire.answers ?? {}, errors)
 checkMappings('SIG Lite historical copy', sigIndex, sig, profiles, questionnaire.answers ?? {}, errors)
 if (sig.status !== 'blocked-licensed-source' || questionnaire.questionSets?.['SIG Lite']?.status !== sig.status || !nonempty(sig.limitation) || !nonempty(sig.requiredInput)) errors.push('Current SIG Lite licence and source limitation must remain explicit.')
 if (context.requireComplete && sig.status !== 'complete-id-mapping') errors.push('Current SIG Lite remains incomplete: ' + sig.limitation)
 return errors
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const errors = checkQuestionnaire(load('deploy.json'), load('security/questionnaire.json'), { requireComplete: process.argv.includes('--require-complete') })
 if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
 else console.log('Declared and source-derived build connectors and every indexed CAIQ and historical SIG response pass. Current 2026 SIG Lite remains blocked on its licensed source; this is not a complete current SIG questionnaire.')
}
