import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'

const day=86400000
export function checkReleaseHistory({releases,advisories,fixes,now=Date.now()}){
 const errors=[],published=releases.filter(r=>!r.draft&&!r.prerelease).map(r=>({...r,time:Date.parse(r.published_at)})).sort((a,b)=>a.time-b.time)
 if(!published.length)errors.push('No published release establishes the release history.')
 if(published.some(r=>!Number.isFinite(r.time)))errors.push('A release has no valid publication timestamp.')
 for(let i=0;i<published.length;i++){
  const end=published[i+1]?.time??now
  if(end-published[i].time>31*day)errors.push('Release cadence exceeds 31 days after '+published[i].tag_name+'.')
 }
 for(const advisory of advisories.filter(a=>a.state==='published')){
  const fix=fixes.find(f=>f.ghsa===advisory.ghsa_id)
  if(!fix){errors.push('Missing merged-fix provenance for '+advisory.ghsa_id+'.');continue}
  const release=published.find(r=>r.tag_name===fix.fixedRelease)
  const merged=Date.parse(fix.mergedAt)
  if(!release||!Number.isFinite(merged)||release.time<merged||release.time-merged>7*day)errors.push('Security fix exceeds seven days or lacks publication evidence: '+advisory.ghsa_id+'.')
  const patched=(advisory.vulnerabilities??[]).map(v=>v.first_patched_version?.identifier??v.patched_versions).filter(Boolean)
  if(!patched.some(version=>version===fix.fixedRelease.replace(/^v/,'')))errors.push('Fixed release does not match advisory patched version: '+advisory.ghsa_id+'.')
 }
 return errors
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const api=path=>JSON.parse(execFileSync('gh',['api',path],{encoding:'utf8',stdio:['ignore','pipe','inherit']}))
 const repo='repos/just-every/run-locket'
 const pages=path=>{const rows=[];for(let page=1;;page++){const next=api(repo+path+(path.includes('?')?'&':'?')+'per_page=100&page='+page);rows.push(...next);if(next.length<100)return rows}}
 const releases=pages('/releases'),advisories=pages('/security-advisories')
 const fixes=JSON.parse(await readFile(new URL('../security/security-fixes.json',import.meta.url),'utf8'))
 for(const fix of fixes){
  const pull=api(repo+'/pulls/'+fix.pull)
  if(!pull.merged_at)throw Error('Security fix pull request is not merged.')
  fix.mergedAt=pull.merged_at
 }
 // Only a release whose tag still resolves counts as a published release.
 for(const release of releases)api(repo+'/git/ref/tags/'+encodeURIComponent(release.tag_name))
 const errors=checkReleaseHistory({releases,advisories,fixes})
 if(errors.length){console.error(errors.join('\n'));process.exitCode=1}else console.log('Release cadence and published security fixes satisfy the history checks.')
}
