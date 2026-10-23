import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
export function checkQuestionnaire(deploy,questionnaire){
 const errors=[],bindings=new Set(questionnaire.subprocessors.flatMap(p=>p.bindings))
 for(const binding of [...deploy.secrets,...deploy.d1.filter(v=>v.environment)].map(v=>v.binding)){
  if(['OWNER_EMAIL','SESSION_SECRET','SETUP_TOKEN','CLICKWRAP_SIGNING_KEY','AI_TRAINING_PROHIBITED','AI_ENABLED'].includes(binding))continue
  if(!bindings.has(binding))errors.push('Unlisted build connector binding: '+binding)
 }
 for(const domain of ['dataFlows','encryption','access','audit','backup','incident','vulnerabilities','responsibility','assurance']){
  if(!questionnaire.answers[domain]?.trim())errors.push('Unanswered security domain: '+domain)
 }
 for(const set of ['SIG Lite','CAIQ'])if(!questionnaire.questionSets[set]?.length)errors.push('Missing question-set response index: '+set)
 return errors
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const load=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'))
 const errors=checkQuestionnaire(await load('../deploy.json'),await load('../security/questionnaire.json'))
 if(errors.length){console.error(errors.join('\n'));process.exitCode=1}else console.log('Security response domains and declared connector coverage pass.')
}
