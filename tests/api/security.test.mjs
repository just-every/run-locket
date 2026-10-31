// Authority is checked in every handler from the current session, not by the
// screens: signed-out, cross-site, revoked, demoted and wrong-role requests fail,
// and a retried command can never apply twice.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { installation } from './harness.mjs'
import { file, find, library, pdf, submitted, team } from './setup.mjs'
import { authorityJourney } from '../agent-door/access-parity.mjs'

test('sessions, roles, idempotent commands and stale writes are enforced by the server', async t => {
  const h = await installation(); t.after(() => h.close())
  const tm = await team(h)
  // Dispatch accepts registered commands only, never Object.prototype names.
  // Keep response content out of assertion diagnostics, including on regressions.
  const registered = await tm.requester.request('/api/locket/commands', { method: 'POST', body: { commandId: randomUUID(), type: 'party.save', payload: { name: 'Dispatch sanity party', kind: 'other' } } })
  assert.equal(registered.status, 200, 'a registered command still works')
  const registeredBody = await registered.json()
  assert.equal(registeredBody.ok === true && typeof registeredBody.result?.id === 'string', true, 'registered command returns its outcome')
  const names = ['unknown.command', 'constructor', '__proto__', 'hasOwnProperty', 'toString', 'valueOf']
  const refusals = []
  for (const type of names) {
    const response = await tm.requester.request('/api/locket/commands', { method: 'POST', body: { commandId: randomUUID(), type, payload: {} } })
    refusals.push({ type, status: response.status, body: await response.text() })
  }
  t.diagnostic('command dispatch statuses: ' + refusals.map(r => r.type + '=' + r.status).join(', '))
  assert.deepEqual(refusals.map(r => r.status), names.map(() => 400), 'inherited names receive the unknown-command status')
  for (const { type, body } of refusals) {
    const expected = JSON.stringify({ ok: false, error: { code: 'UNKNOWN_COMMAND', message: `Unknown command ${type}.`, details: null } })
    assert.equal(body === expected, true, 'unknown-command body contains only the expected refusal; no bindings or environment content')
  }
  const viewer = await h.invite('viewer@example.test', 'viewer')
  const agent = await h.invite('agent@example.test', 'agent')
  const lib = await library(h, tm)

  // Signed out and cross-site requests are refused before any work.
  assert.equal((await h.request('/api/locket/state')).status, 401)
  assert.equal((await h.request('/api/locket/commands', { method: 'POST', body: { commandId: randomUUID(), type: 'party.save', payload: { name: 'X', kind: 'other' } } })).status, 401)
  const crossSite = await h.owner.request('/api/locket/commands', { method: 'POST', headers: { origin: 'https://attacker.example' }, body: { commandId: randomUUID(), type: 'party.save', payload: { name: 'X', kind: 'other' } } })
  assert.equal(crossSite.status, 403)

  // Viewers read; agents prepare; neither writes agreements or approves.
  const id = await submitted(h, tm, lib)
  const a = await find(viewer, id)
  await viewer.command('request.create', { title: 'x', type: 'nda', party: { name: 'y', kind: 'other' } }, { error: 'FORBIDDEN' })
  await agent.command('request.create', { title: 'x', type: 'nda', party: { name: 'y', kind: 'other' } }, { error: 'FORBIDDEN' })
  await agent.command('approval.decide', { agreementId: id, version: a.version, versionId: a.current_version_id, kind: 'commercial', decision: 'approved' }, { error: 'FORBIDDEN' })
  await agent.command('role.set', { operatorId: agent.id, role: 'counsel' }, { error: 'FORBIDDEN' })
  await tm.counsel.command('role.set', { operatorId: viewer.id, role: 'approver' }, { error: 'FORBIDDEN' })
  const intake = await agent.command('proposal.prepare', { kind: 'intake', payload: { title: 'Prepared NDA', type: 'nda', party: { name: 'Prepared Co', kind: 'partner' } }, evidence: ['Email from Prepared Co asking for an NDA'] })
  await agent.command('proposal.decide', { proposalId: intake.id, decision: 'approve' }, { error: 'FORBIDDEN' })
  assert.equal((await h.owner.state()).agreements.length, 1)

  // The same command identity returns its first outcome; different content is refused.
  const commandId = randomUUID()
  const first = await tm.requester.command('party.save', { name: 'Idempotent Pty Ltd', kind: 'customer' }, { commandId })
  const again = await tm.requester.command('party.save', { name: 'Idempotent Pty Ltd', kind: 'customer' }, { commandId })
  assert.deepEqual(again, first)
  assert.equal((await h.owner.state()).parties.filter(p => p.name === 'Idempotent Pty Ltd').length, 1)
  await tm.requester.command('party.save', { name: 'Other', kind: 'customer' }, { commandId, error: 'IDEMPOTENCY' })
  await tm.approver.command('party.save', { name: 'Idempotent Pty Ltd', kind: 'customer' }, { commandId, error: 'IDEMPOTENCY' })

  // A decision made against an earlier snapshot of the agreement is refused.
  await tm.approver.command('approval.decide', { agreementId: id, version: a.version - 1, versionId: a.current_version_id, kind: 'commercial', decision: 'approved' }, { error: 'STALE' })

  // A demoted approver loses authority on the next request; a revoked session is refused.
  await h.owner.command('role.set', { operatorId: tm.approver.id, role: 'viewer' })
  await tm.approver.command('approval.decide', { agreementId: id, version: a.version, versionId: a.current_version_id, kind: 'commercial', decision: 'approved' }, { error: 'FORBIDDEN' })
  const out = await tm.requester.request('/auth/signout', { method: 'POST', body: {} })
  assert.ok(out.status < 400)
  const revoked = await tm.requester.request('/api/locket/commands', { method: 'POST', body: { commandId: randomUUID(), type: 'requirement.add', payload: { agreementId: id, label: 'x' } } })
  assert.equal(revoked.status, 401)
  assert.equal((await tm.requester.request('/api/locket/files/' + (await h.owner.state()).artifacts[0].id)).status, 401)

  // The owner remains able to work, and the record of who did what is intact.
  await h.owner.command('requirement.attach', { agreementId: id, requirementId: (await h.owner.state()).requirements.find(r => r.agreement_id === id).id, file: file('again.pdf', pdf('again')) })
  const audit = (await h.owner.state()).audit.filter(x => x.agreement_id === id)
  assert.ok(audit.some(x => x.action === 'agreement.submit' && x.actor_role === 'requester'))
  await authorityJourney()
})

test('a restricted request prepared by an agent stays hidden, counterparty included, from everyone outside it', async t => {
  const h = await installation(); t.after(() => h.close())
  const tm = await team(h)
  const viewer = await h.invite('viewer@example.test', 'viewer')
  const agent = await h.invite('agent@example.test', 'agent')
  const outsiders = [viewer, tm.requester, tm.approver]
  const mentions = async client => JSON.stringify(await client.state()).includes('Falcon')
  const prepared = await agent.command('proposal.prepare', { kind: 'intake', payload: { title: 'Project Falcon acquisition NDA', type: 'nda', party: { name: 'Falcon Holdings', kind: 'other' }, value: '2500000', restricted: true }, evidence: ['Board minute 14'] })
  // Pending: only its preparer, the owner and counsel know it exists.
  for (const outsider of outsiders) assert.equal(await mentions(outsider), false)
  assert.ok((await agent.state()).proposals.some(p => p.id === prepared.id))
  await tm.requester.command('proposal.decide', { proposalId: prepared.id, decision: 'approve' }, { error: 'NOT_FOUND' })
  // Approved: the agreement, its proposal and its new counterparty follow the agreement's own visibility.
  const decided = await tm.counsel.command('proposal.decide', { proposalId: prepared.id, decision: 'approve' })
  for (const outsider of outsiders) assert.equal(await mentions(outsider), false)
  const s = await tm.counsel.state()
  assert.equal(s.agreements.find(a => a.id === decided.outcome.id).restricted, 1)
  assert.equal(s.proposals.find(p => p.id === prepared.id).agreement_id, decided.outcome.id)
  assert.ok(s.parties.some(p => p.name === 'Falcon Holdings'))
  await tm.counsel.command('access.set', { agreementId: decided.outcome.id, operatorId: viewer.id, grant: 'grant' })
  assert.equal(await mentions(viewer), true)
})

test('only the owner or counsel change whether an agreement is restricted', async t => {
  const h = await installation(); t.after(() => h.close())
  const tm = await team(h)
  const viewer = await h.invite('viewer@example.test', 'viewer')
  const made = await h.owner.command('request.create', { title: 'synthetic-locket-1 board paper', type: 'nda', party: { name: 'synthetic-locket-1 party', kind: 'other' }, restricted: true })
  await h.owner.command('access.set', { agreementId: made.id, operatorId: tm.requester.id, grant: 'grant' })
  // A person granted access keeps editing the details, but the restriction stays.
  let a = await find(tm.requester, made.id)
  await tm.requester.command('request.update', { agreementId: a.id, version: a.version, restricted: false }, { error: 'FORBIDDEN' })
  await tm.requester.command('request.update', { agreementId: a.id, version: a.version, title: 'synthetic-locket-1 revised paper', restricted: true })
  assert.deepEqual((await viewer.state()).agreements, [])
  // Counsel lifts it; a requester cannot put it back.
  a = await find(tm.counsel, made.id)
  await tm.counsel.command('request.update', { agreementId: a.id, version: a.version, restricted: false })
  assert.deepEqual((await viewer.state()).agreements.map(x => [x.id, x.title]), [[made.id, 'synthetic-locket-1 revised paper']])
  a = await find(tm.requester, made.id)
  await tm.requester.command('request.update', { agreementId: a.id, version: a.version, restricted: true }, { error: 'FORBIDDEN' })
  assert.equal((await find(viewer, made.id)).restricted, 0)
})

test('a counterparty known only through restricted agreements is never matched, chosen or edited from outside them', async t => {
  const h = await installation(); t.after(() => h.close())
  const tm = await team(h)
  const details = { name: 'synthetic-locket-2 Holdings', kind: 'other', email: 'synthetic-locket-2@example.test', registeredAddress: '2 Synthetic Lane', contacts: [{ name: 'Synthetic Contact', email: 'synthetic-locket-2-contact@example.test' }] }
  const secret = await tm.counsel.command('request.create', { title: 'synthetic-locket-2 confidential matter', type: 'nda', party: details, restricted: true })
  const party = (await tm.counsel.state()).parties.find(p => p.name === details.name)
  const mentions = async () => JSON.stringify(await tm.requester.state()).includes('synthetic-locket-2')
  assert.equal(await mentions(), false)
  await tm.requester.command('request.create', { title: 'Ordinary request', type: 'nda', party: { name: 'SYNTHETIC-LOCKET-2 holdings', kind: 'other' } }, { error: 'PARTY_UNAVAILABLE' })
  await tm.requester.command('request.create', { title: 'Ordinary request', type: 'nda', partyId: party.id }, { error: 'INVALID' })
  await tm.requester.command('party.save', { id: party.id, version: party.version, name: details.name, kind: 'other', email: 'synthetic-locket-2-changed@example.test' }, { error: 'NOT_FOUND' })
  assert.equal(await mentions(), false)
  const s = await tm.counsel.state()
  assert.deepEqual(s.agreements.map(a => a.party_id), [party.id])
  assert.equal(s.parties.find(p => p.id === party.id).email, details.email)
  // Someone inside the agreement still reuses the recorded counterparty by name.
  await tm.counsel.command('access.set', { agreementId: secret.id, operatorId: tm.requester.id, grant: 'grant' })
  const follow = await tm.requester.command('request.create', { title: 'synthetic-locket-2 follow-on', type: 'nda', party: { name: 'SYNTHETIC-LOCKET-2 holdings', kind: 'other' }, restricted: true })
  assert.equal((await find(tm.requester, follow.id)).party_id, party.id)
})

test('Workforce SAML admission and SCIM Counsel mapping revoke the open native session on deactivation',async t=>{
 const {workforceBindings,enableWorkforce,provision,scim,samlLogin}=await import('./workforce-fixture.mjs')
 const h=await installation({bindings:workforceBindings});t.after(()=>h.close())
 await enableWorkforce(h);const user=await provision(h)
 const {response}=await samlLogin(h)
 assert.equal(response.status,303,await response.text())
 const cookie=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
 const state=await h.request('/api/locket/state',{as:cookie});assert.equal(state.status,200)
 const body=await state.json();assert.equal(body.actor.role,'counsel');assert.equal(body.actor.id,user.id)
 const group=await(await scim(h,'/Groups/Counsel')).json();assert.equal(group.members[0].value,user.id)
 const department=(await h.owner.state()).intakeAudiences.find(g=>g.name==='Counsel');assert.equal(department.kind,'department');assert.ok(department.memberIds.includes(user.id))
 await h.owner.command('role.set',{operatorId:user.id,role:'approver'},{error:'WORKFORCE_MANAGED'})
 const patch=await scim(h,'Users/'+user.id,{method:'PATCH',body:{Operations:[{op:'replace',path:'active',value:false}]}})
 assert.equal(patch.status,200,await patch.text())
 const denied=await h.request('/api/locket/commands',{method:'POST',as:cookie,body:{commandId:randomUUID(),type:'request.create',payload:{title:'Must be refused',type:'nda',counterparty:'Synthetic'}}});assert.equal(denied.status,401)
 assert.equal((await samlLogin(h)).response.status,403)
 assert.equal((await(await scim(h,'/Groups/Counsel')).json()).members.length,0)
 const archived=await(await h.owner.request('/api/locket/export')).json();assert.equal(archived.records.lk_workforce_users.length,1);assert.ok(!JSON.stringify(archived).includes(workforceBindings.WORKFORCE_SCIM_TOKEN));assert.ok(archived.records.lk_audit.some(a=>a.action==='workforce.user.update'))
})

test('Workforce refuses forged, replayed, misdirected and unprovisioned SAML identities and protects local operators',async t=>{
 const {workforceBindings,enableWorkforce,provision,scim,samlLogin,samlStart,samlResponse}=await import('./workforce-fixture.mjs')
 const h=await installation({bindings:workforceBindings});t.after(()=>h.close())
 assert.equal((await scim(h,'Users')).status,403)
 const {groups}=await import('./workforce-fixture.mjs')
 const configuration={version:0,enabled:true,consent:true,groups}
 const local=await h.invite('synthetic-locket-local@example.test','counsel')
 await local.command('workforce.configure',configuration,{error:'FORBIDDEN'})
 await h.owner.command('workforce.configure',{...configuration,consent:false},{error:'CONSENT'})
 const signedOut=await h.request('/api/locket/commands',{method:'POST',body:{commandId:randomUUID(),type:'workforce.configure',payload:configuration}})
 assert.equal(signedOut.status,401)
 const token=await h.owner.command('token.create',{label:'synthetic-locket-consent',expiresAt:Date.now()+120000,commands:['workforce.configure'],reads:[]})
 const delegated=await h.request('/api/locket/commands',{method:'POST',headers:{authorization:'Bearer '+token.token},body:{commandId:randomUUID(),type:'workforce.configure',payload:configuration}})
 assert.equal(delegated.status,403)
 assert.equal((await scim(h,'Users')).status,403,'refused consent must leave provisioning disabled')
 await enableWorkforce(h);const user=await provision(h)
 await h.owner.command('workforce.configure',{...configuration,version:1,groups:[{...groups[0],role:'viewer'}]},{error:'IMMUTABLE'})
 assert.equal((await scim(h,'Users',{method:'POST',body:{externalId:'synthetic-locket-local',userName:'synthetic-locket-local@example.test',displayName:'Replacement',active:true}})).status,409)
 assert.equal((await scim(h,'/Groups/Counsel',{method:'PATCH',body:{Operations:[{op:'add',path:'members',value:[{value:local.id}]}]}})).status,400)
 const identity=await(await scim(h,'Users/'+user.id)).json()
 for(const change of [{externalId:'synthetic-locket-reassigned'},{userName:'synthetic-locket-other@example.test'}]){
  const replaced=await scim(h,'Users/'+user.id,{method:'PUT',body:{...identity,...change}})
  assert.equal(replaced.status,400)
  const [path,value]=Object.entries(change)[0]
  assert.equal((await scim(h,'Users/'+user.id,{method:'PATCH',body:{Operations:[{op:'replace',path,value}]}})).status,400)
 }
 assert.equal((await scim(h,'Users/'+user.id,{method:'DELETE'})).status,405)
 assert.deepEqual(await(await scim(h,'Users/'+user.id)).json(),identity,'refused identity changes and deletion preserve the managed account')
 assert.equal((await local.state()).actor.role,'counsel','local account authority is preserved')
 assert.equal((await(await scim(h,'/Groups/Counsel')).json()).members[0].value,user.id)
 assert.equal((await h.owner.state()).intakeAudiences.find(g=>g.name==='Counsel').kind,'department')
 for(const options of [{unsigned:true},{tamper:true},{recipient:'https://attacker.example.com'},{destination:'https://attacker.example.com'},{issuer:'https://attacker.example.com'},{audience:'https://attacker.example.com'},{expired:true},{subject:'unprovisioned',email:'owner@example.test'}])assert.equal((await samlLogin(h,options)).response.status,403,JSON.stringify(options))
 const start=await samlStart(h),body=samlResponse(h,start,{email:'owner@example.test'})
 const send=cookie=>h.mf.dispatchFetch(h.origin+'/auth/saml/callback',{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded',...(cookie?{cookie}:{})},body})
 assert.equal((await send()).status,403)
 const admitted=await send(start.cookie);assert.equal(admitted.status,303)
 const admittedCookie=admitted.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
 const admittedState=await(await h.request('/api/locket/state',{as:admittedCookie})).json()
 assert.equal(admittedState.actor.id,user.id);assert.equal(admittedState.actor.role,'counsel','refused remapping preserves the approved role')
 assert.equal((await(await h.request('/auth/session',{as:admittedCookie})).json()).operator.email,user.userName,'a signed email attribute cannot replace the provisioned account association')
 assert.equal((await send(start.cookie)).status,403)
 assert.equal((await scim(h,'Users',{token:'synthetic-locket-wrong-credential'})).status,401)
 assert.equal((await scim(h,'Users',{method:'POST',body:{externalId:'owner',userName:'owner@example.test',displayName:'Attacker',active:true}})).status,409)
 const owner=(await h.owner.state()).actor
 assert.equal((await scim(h,'Users/'+owner.id,{method:'PATCH',body:{Operations:[{op:'replace',path:'active',value:false}]}})).status,404)
 assert.equal((await h.owner.state()).actor.role,'owner')
})

test('Workforce group updates, user changes and owner consent withdrawal remove stale authority',async t=>{
 const {workforceBindings,enableWorkforce,provision,scim,samlLogin}=await import('./workforce-fixture.mjs')
 const h=await installation({bindings:workforceBindings});t.after(()=>h.close());await enableWorkforce(h);const user=await provision(h)
 const login=async()=>{const {response}=await samlLogin(h);assert.equal(response.status,303);return response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')}
 const first=await login()
 const add=await scim(h,'/Groups/Viewers',{method:'PATCH',body:{Operations:[{op:'add',path:'members',value:[{value:user.id}]}]}});assert.equal(add.status,200)
 assert.equal((await h.request('/api/locket/state',{as:first})).status,401)
 const second=await login(),state=await(await h.request('/api/locket/state',{as:second})).json();assert.equal(state.actor.role,'viewer')
 const remove=await scim(h,'/Groups/Viewers',{method:'PATCH',body:{Operations:[{op:'remove',path:`members[value eq "${user.id}"]`}]}});assert.equal(remove.status,200)
 assert.equal((await h.request('/api/locket/state',{as:second})).status,401)
 const third=await login();assert.equal((await(await h.request('/api/locket/state',{as:third})).json()).actor.role,'counsel')
 const current=await(await scim(h,'Users/'+user.id)).json()
 const stale=await scim(h,'Users/'+user.id,{method:'PATCH',headers:{'if-match':'W/"0"'},body:{Operations:[{op:'replace',path:'displayName',value:'Wrong stale name'}]}});assert.equal(stale.status,412)
 const update=await scim(h,'Users/'+user.id,{method:'PATCH',headers:{'if-match':current.meta.version},body:{Operations:[{op:'replace',path:'displayName',value:'Updated Counsel'}]}});assert.equal(update.status,200);assert.equal((await update.json()).displayName,'Updated Counsel')
 assert.equal((await h.request('/api/locket/state',{as:third})).status,401)
 const fourth=await login()
 await h.owner.command('workforce.configure',{version:1,enabled:false,consent:true})
 assert.equal((await h.request('/api/locket/state',{as:fourth})).status,401);assert.equal((await scim(h,'Users')).status,403);assert.equal((await h.request('/auth/saml/start')).status,403)
 await h.owner.command('workforce.configure',{version:2,enabled:true,consent:true})
 assert.equal((await(await scim(h,'Users/'+user.id)).json()).active,false,'renewed consent does not reactivate managed people')
 assert.equal((await samlLogin(h)).response.status,403)
 assert.equal((await h.owner.state()).actor.role,'owner')
})
