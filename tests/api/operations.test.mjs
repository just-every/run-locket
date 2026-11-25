import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { checkReleaseHistory } from '../../scripts/release-history.mjs'
import { checkQuestionnaire } from '../../scripts/security-questionnaire.mjs'

test('Release history refuses missing releases, every oversized cadence gap and security fixes without timely merged provenance',()=>{
 const day=86400000,at=Date.parse('2026-10-01T00:00:00Z'),release={tag_name:'v0.1.0',published_at:new Date(at).toISOString()},base={releases:[release],advisories:[],fixes:[],now:at+31*day}
 assert.deepEqual(checkReleaseHistory(base),[])
 assert.ok(checkReleaseHistory({...base,now:at+31*day+1}).length)
 assert.ok(checkReleaseHistory({...base,releases:[]}).length)
 const advisory={ghsa_id:'synthetic-locket-1',state:'published',vulnerabilities:[{first_patched_version:{identifier:'0.1.0'}}]}
 const proof={...base,advisories:[advisory],fixes:[{ghsa:advisory.ghsa_id,fixedRelease:'v0.1.0',mergedAt:new Date(at-7*day).toISOString()}]}
 assert.deepEqual(checkReleaseHistory(proof),[])
 assert.ok(checkReleaseHistory({...proof,fixes:[]}).length)
 assert.ok(checkReleaseHistory({...proof,fixes:[{...proof.fixes[0],mergedAt:new Date(at-7*day-1).toISOString()}]}).length)
 assert.ok(checkReleaseHistory({...base,releases:[release,{...release,tag_name:'v0.2.0',published_at:new Date(at+32*day).toISOString()}],now:at+32*day}).length)
})
test('Security response coverage fails when a declared build connector is absent or a required domain is unanswered',async()=>{
 const deploy=JSON.parse(await readFile('deploy.json','utf8')),answers=JSON.parse(await readFile('security/questionnaire.json','utf8'))
 assert.deepEqual(checkQuestionnaire(deploy,answers),[])
 assert.ok(checkQuestionnaire({...deploy,secrets:[...deploy.secrets,{binding:'SYNTHETIC_NEW_CONNECTOR'}]},answers).length)
 assert.ok(checkQuestionnaire(deploy,{...answers,answers:{...answers.answers,backup:''}}).length)
})
