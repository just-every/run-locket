import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { installation } from './harness.mjs'
import { file, pdf, docx } from './files.mjs'

const wording = {
  preferred: 'Each party indemnifies the other for its negligence.',
  fallback1: 'Each party indemnifies the other for its gross negligence.',
  fallback2: 'Each party indemnifies the other for its wilful misconduct.',
  'walk-away': 'Neither party provides an indemnity.',
}
const clauses = [{ key: 'indemnity', title: 'Indemnity', notes: 'Use mutual indemnity for mutual risk.', ruleKey: 'indemnity', variants: Object.entries(wording).map(([id, text]) => ({ id, label: id, text, notes: id === 'fallback1' ? 'Use if the preferred wording is rejected.' : '' })) }]
async function library(h, approve = true) {
  const template = await h.owner.command('template.create', { name: 'Negotiation clauses', type: 'nda', body: 'NDA\n[[clause:indemnity]]', fields: [], clauses })
  if (approve) await h.owner.command('template.decide', { versionId: template.versionId, decision: 'approve' })
  const playbook = await h.owner.command('playbook.draft', { rules: [{ key: 'indemnity', title: 'Mutual indemnity', preferred: wording.preferred, alternatives: [wording.fallback1, wording.fallback2, wording['walk-away']], authority: 'counsel', guidance: 'Escalate non-mutual risk.' }] })
  await h.owner.command('playbook.activate', { id: playbook.id })
  return { ...template, playbookId: playbook.id }
}
const readClauses = async client => (await (await client.request('/api/locket/clause-library?q=indemnity')).json()).results
const agreement = async (client, id) => (await client.state()).agreements.find(a => a.id === id)
async function create(h, body = 'NDA\nIndemnity remains to be agreed.') {
  return h.owner.command('request.create', { title: 'Mutual NDA', type: 'nda', party: { name: 'Example customer', kind: 'customer' }, file: file('negotiation.docx', docx(body.split('\n'))) })
}
async function insert(h, lib, id, variantId = 'fallback1') {
  const a = await agreement(h.owner, id)
  const s = await h.owner.state(), base = s.versions.find(v => v.id === a.current_version_id)
  const quote = 'Indemnity remains to be agreed.', start = base.text.indexOf(quote)
  return h.owner.command('clause.insert', { agreementId: id, version: a.version, versionId: base.id, libraryVersionId: lib.versionId, clauseKey: 'indemnity', variantId, start, end: start + quote.length, quote })
}
async function execute(h, id) {
  let a = await agreement(h.owner, id)
  if (a.status === 'draft') await h.owner.command('agreement.submit', { agreementId: id, version: a.version })
  a = await agreement(h.owner, id)
  await h.owner.command('approval.decide', { agreementId: id, version: a.version, versionId: a.current_version_id, kind: 'commercial', decision: 'approved' })
  a = await agreement(h.owner, id)
  const pkg = await h.owner.command('package.prepare', { agreementId: id, version: a.version, provider: 'docusign', recipients: [{ name: 'Alex', email: 'alex@example.test', action: 'sign' }] })
  a = await agreement(h.owner, id)
  const envelopeId = `ENV-${id}`
  await h.owner.command('package.sent', { agreementId: id, version: a.version, packageId: pkg.packageId, envelopeId })
  a = await agreement(h.owner, id)
  await h.owner.command('execution.record', { agreementId: id, version: a.version, envelopeId, executedOn: '2026-10-19', documentConfirmed: true, signers: [{ name: 'Alex', email: 'alex@example.test' }], signed: file('signed.pdf', Buffer.from(await (await h.owner.request('/api/locket/files/' + pkg.pdfArtifactId)).arrayBuffer())), certificate: file('certificate.pdf', pdf(`Certificate ${id}`)) })
}

test('DRAFT-003 searches approved variants and records insertion provenance through execution and export', async t => {
  const h = await installation(); t.after(() => h.close())
  const lib = await library(h)
  let results = await readClauses(h.owner)
  assert.deepEqual(new Set(results.map(r => r.variantId)), new Set(Object.keys(wording)))
  const fallback = results.find(r => r.variantId === 'fallback1')
  assert.match(fallback.notes, /preferred wording is rejected/)
  assert.equal(fallback.rule.key, 'indemnity')
  assert.equal(fallback.playbookVersionId, lib.playbookId)
  const request = await create(h)
  const before = await h.owner.state(), original = before.artifacts.find(f => f.version_id === request.versionId)
  const bytes = Buffer.from(await (await h.owner.request(`/api/locket/files/${original.id}`)).arrayBuffer())
  const inserted = await insert(h, lib, request.id)
  let state = await h.owner.state(), version = state.versions.find(v => v.id === inserted.versionId)
  assert.match(version.text, /gross negligence/)
  const use = JSON.parse(version.fields).clauseLibrary[0]
  assert.equal(use.libraryVersionId, lib.versionId)
  assert.equal(use.variantId, 'fallback1')
  assert.equal(use.text, wording.fallback1)
  assert.equal(use.playbookVersionId, lib.playbookId)
  assert.equal((await readClauses(h.owner)).find(r => r.variantId === 'fallback1').acceptanceCount, 0)
  await execute(h, request.id)
  assert.equal((await readClauses(h.owner)).find(r => r.variantId === 'fallback1').acceptanceCount, 1)
  assert.equal((await readClauses(h.owner)).find(r => r.variantId === 'preferred').acceptanceCount, 0)
  assert.deepEqual(Buffer.from(await (await h.owner.request(`/api/locket/files/${original.id}`)).arrayBuffer()), bytes)
  const exported = await (await h.owner.request('/api/locket/export')).json()
  assert.deepEqual(JSON.parse(exported.records.lk_versions.find(v => v.id === inserted.versionId).fields).clauseLibrary, [use])
  assert.ok((await h.owner.state()).audit.some(e => e.action === 'clause.insert' && e.agreement_id === request.id))
})

test('DRAFT-003 counts retained template selections and negotiation insertions in the executed current version', async t => {
  const h = await installation(); t.after(() => h.close())
  const lib = await library(h)
  const untouched = await h.owner.command('request.create', { title: 'Template choice', type: 'nda', party: { name: 'Example customer', kind: 'customer' }, templateVersionId: lib.versionId, fields: {}, clauseChoices: { indemnity: 'fallback1' } })
  await execute(h, untouched.id)
  assert.equal((await readClauses(h.owner)).find(r => r.variantId === 'fallback1').acceptanceCount, 1)
  const retained = await create(h)
  await insert(h, lib, retained.id)
  let a = await agreement(h.owner, retained.id)
  await h.owner.command('version.upload', { agreementId: a.id, version: a.version, kind: 'counterparty', file: file('retained.pdf', pdf('Counterparty retained clause')), text: `NDA amended\n${wording.fallback1}` })
  await execute(h, retained.id)
  assert.equal((await readClauses(h.owner)).find(r => r.variantId === 'fallback1').acceptanceCount, 2)
  const removed = await create(h)
  await insert(h, lib, removed.id)
  a = await agreement(h.owner, removed.id)
  await h.owner.command('version.upload', { agreementId: a.id, version: a.version, kind: 'counterparty', file: file('removed.pdf', pdf('Indemnity removed')), text: 'NDA amended. No indemnity agreed.' })
  await execute(h, removed.id)
  assert.equal((await readClauses(h.owner)).find(r => r.variantId === 'fallback1').acceptanceCount, 2)
})

test('DRAFT-003 enforces approval, authority, current-version and citation guards', async t => {
  const h = await installation(); t.after(() => h.close())
  const lib = await library(h, false), request = await create(h)
  const a = await agreement(h.owner, request.id)
  const base = (await h.owner.state()).versions.find(v => v.id === a.current_version_id)
  const payload = { agreementId: a.id, version: a.version, versionId: base.id, libraryVersionId: lib.versionId, clauseKey: 'indemnity', variantId: 'fallback1', start: 0, end: 0, quote: '' }
  assert.deepEqual(await readClauses(h.owner), [])
  await h.owner.command('clause.insert', payload, { error: 'TEMPLATE_NOT_APPROVED' })
  await h.owner.command('template.decide', { versionId: lib.versionId, decision: 'approve' })
  await h.owner.command('clause.insert', { ...payload, end: 3, quote: 'not the text' }, { error: 'CITATION' })
  const viewer = await h.invite('viewer@example.test', 'viewer')
  await viewer.command('clause.insert', payload, { error: 'FORBIDDEN' })
  await h.owner.command('clause.insert', payload)
  await h.owner.command('clause.insert', payload, { error: 'NOT_CURRENT' })
  const current = await agreement(h.owner, a.id)
  await h.owner.command('clause.insert', { ...payload, versionId: current.current_version_id }, { error: 'STALE' })
  await h.owner.command('template.decide', { versionId: lib.versionId, decision: 'retire' })
  assert.deepEqual(await readClauses(h.owner), [])
})


test('DRAFT-004 authors four source fields and an optional paragraph, previews and approves immutable Word then a requester generates without losing formatting',async t=>{
 const {wordTemplateFixture}=await import('./word-template-fixture.mjs'),{mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{execFileSync}=await import('node:child_process')
 const h=await installation();t.after(()=>h.close())
 const counsel=await h.invite('synthetic-locket-word-counsel@example.test','counsel'),requester=await h.invite('synthetic-locket-word-requester@example.test','requester'),f=wordTemplateFixture()
 const draft=await counsel.command('template.word.upload',{name:'Firm NDA',type:'nda',file:f.file})
 await counsel.command('template.decide',{versionId:draft.versionId,decision:'approve'},{error:'PREVIEW'})
 const marked=await counsel.command('template.word.mark',{versionId:draft.versionId,revision:1,marks:f.marks})
 const preview=await counsel.command('template.word.preview',{...marked,fields:f.fields,clauseChoices:{processing:'omit'}})
 assert.match(preview.text,/North & South LLP and Ridgeway Services/)
 assert.ok(!preview.text.includes('Data processing requires'))
 await counsel.command('template.decide',{versionId:draft.versionId,decision:'approve'})
 await counsel.command('template.word.mark',{...marked,marks:f.marks},{error:'STATUS'})
 const payload={title:'Ridgeway NDA',type:'nda',party:{name:'Ridgeway Services',kind:'partner'},templateVersionId:draft.versionId,fields:f.fields,clauseChoices:{processing:'include'}}
 const generated=await requester.command('request.create',payload),s=await h.owner.state(),v=s.versions.find(v=>v.id===generated.versionId),source=s.wordTemplates.find(w=>w.id===draft.versionId)
 assert.match(v.text,/North & South LLP and Ridgeway Services/)
 assert.match(v.text,/February 2, 2027/);assert.match(v.text,/Joint evaluation/);assert.match(v.text,/Data processing requires written instructions/)
 assert.equal(JSON.parse(v.fields).template,draft.versionId)
 assert.deepEqual(Buffer.from(await(await requester.request(`/api/locket/files/${source.source_artifact_id}`)).arrayBuffer()),f.source)
 const original=s.artifacts.find(a=>a.version_id===v.id&&a.role==='original')
 const bytes=Buffer.from(await(await requester.request(`/api/locket/files/${original.id}`)).arrayBuffer())
 assert.equal(createHash('sha256').update(bytes).digest('hex'),original.sha256)
 const root=await mkdtemp(join(tmpdir(),'locket-word-assertions-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=join(root,'generated.docx');await writeFile(path,bytes)
 execFileSync('unzip',['-t',path])
 const part=name=>execFileSync('unzip',['-p',path,name.replaceAll('[','[[]')],{encoding:'utf8'})
 for(const[name,content]of f.parts.filter(([name])=>name!=='word/document.xml'))assert.equal(part(name),content,`Preserved ${name}`)
 const xml=part('word/document.xml')
 assert.match(xml,/North &amp; South LLP/);assert.match(xml,/<w:b\/>/);assert.match(xml,/<w:numId w:val="1"/)
 assert.equal((xml.match(/<w:tr>/g)??[]).length,5)
 assert.match(v.text,/A\n100.00\nB\n200.00\nC\n300.00\nTotal\n600.00/)
 const omitted=await requester.command('request.create',{...payload,title:'NDA without processing',clauseChoices:{processing:'omit'}})
 const omittedVersion=(await h.owner.state()).versions.find(v=>v.id===omitted.versionId)
 assert.ok(!omittedVersion.text.includes('Data processing requires'))
 assert.notEqual(omittedVersion.digest,v.digest)
 const archive=await(await h.owner.request('/api/locket/export')).json()
 assert.equal(archive.records.lk_word_templates[0].id,draft.versionId)
 assert.deepEqual(Buffer.from(archive.files.find(a=>a.id===original.id).base64,'base64'),bytes)
 assert.ok(s.audit.some(a=>a.action==='template.word.preview'))
})

test('DRAFT-004 refuses forged or overlapping markings, stale previews, unapproved use and unsafe Word sources without changing originals',async t=>{
 const {wordTemplateFixture}=await import('./word-template-fixture.mjs'),{zip}=await import('./files.mjs')
 const h=await installation();t.after(()=>h.close())
 const viewer=await h.invite('synthetic-locket-word-viewer@example.test','viewer'),f=wordTemplateFixture()
 await viewer.command('template.word.upload',{name:'No',type:'nda',file:f.file},{error:'FORBIDDEN'})
 const draft=await h.owner.command('template.word.upload',{name:'Firm NDA',type:'nda',file:f.file})
 await h.owner.command('template.word.mark',{versionId:draft.versionId,revision:1,marks:[{...f.marks[0],quote:'Unrelated text'}]},{error:'CITATION'})
 await h.owner.command('template.word.mark',{versionId:draft.versionId,revision:1,marks:[f.marks[0],{...f.marks[0],name:'overlap'}]},{error:'WORD_SELECTION'})
 const marked=await h.owner.command('template.word.mark',{versionId:draft.versionId,revision:1,marks:f.marks})
 await h.owner.command('template.word.preview',{versionId:draft.versionId,revision:1,fields:f.fields},{error:'STALE'})
 await h.owner.command('template.word.preview',{...marked,fields:{},clauseChoices:{processing:'include'}},{error:'FIELDS'})
 await h.owner.command('template.word.preview',{...marked,fields:f.fields})
 const next=await h.owner.command('template.word.mark',{...marked,marks:f.marks.map(m=>({...m,label:m.label+' reviewed'}))})
 await h.owner.command('template.decide',{versionId:draft.versionId,decision:'approve'},{error:'PREVIEW'})
 await h.owner.command('request.create',{title:'Unapproved',type:'nda',party:{name:'Synthetic',kind:'partner'},templateVersionId:draft.versionId,fields:f.fields},{error:'TEMPLATE_NOT_APPROVED'})
 await h.owner.command('template.word.preview',{...next,fields:f.fields})
 await h.owner.command('template.decide',{versionId:draft.versionId,decision:'approve'})
 await h.owner.command('template.revise',{templateId:draft.id,body:'text',fields:[],clauses:[]},{error:'WORD_TEMPLATE'})
 const unsafe=zip([...f.parts,['word/unsafe.xml','<w:ins xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>']])
 await h.owner.command('template.word.upload',{name:'Unsafe',type:'nda',file:{filename:'unsafe.docx',base64:unsafe.toString('base64')}},{error:'DOCX_UNSUPPORTED'})
 const revised=await h.owner.command('template.word.upload',{templateId:draft.id,file:f.file})
 assert.notEqual(revised.versionId,draft.versionId)
 assert.equal((await h.owner.state()).templateVersions.find(v=>v.id===draft.versionId).status,'approved')
 await h.owner.command('template.decide',{versionId:draft.versionId,decision:'retire'})
 await h.owner.command('request.create',{title:'Retired',type:'nda',party:{name:'Synthetic',kind:'partner'},templateVersionId:draft.versionId,fields:f.fields},{error:'TEMPLATE_NOT_APPROVED'})
})


test('DRAFT-002 populated Word MSA keeps conditional wording and three price rows, requires the reviewed PDF and pins its approval for signing',async t=>{
 const {approvedWordFixture}=await import('./word-template-fixture.mjs')
 const h=await installation();t.after(()=>h.close())
 const f=await approvedWordFixture(h,{type:'supplier'}),requester=await h.invite('synthetic-locket-word-sender@example.test','requester')
 const created=await requester.command('request.create',{title:'Supplier MSA from Word',type:'supplier',party:{name:'Ridgeway Services',kind:'supplier'},templateVersionId:f.versionId,fields:f.fields,clauseChoices:{processing:'include'}})
 const current=async()=>(await h.owner.state()).agreements.find(a=>a.id===created.id)
 let s=await h.owner.state(),v=s.versions.find(v=>v.id===created.versionId)
 assert.match(v.text,/MASTER SERVICES AGREEMENT/);assert.match(v.text,/Data processing requires/)
 assert.match(v.text,/A\n100.00\nB\n200.00\nC\n300.00\nTotal\n600.00/)
 for(const requirement of s.requirements.filter(r=>r.agreement_id===created.id))await requester.command('requirement.attach',{agreementId:created.id,requirementId:requirement.id,file:file('required.pdf',pdf(requirement.label))})
 await requester.command('agreement.submit',{agreementId:created.id,version:(await current()).version})
 const approve=async()=>h.owner.command('approval.decide',{agreementId:created.id,version:(await current()).version,versionId:created.versionId,kind:'commercial',decision:'approved'})
 await approve()
 const packageInput=async()=>({agreementId:created.id,version:(await current()).version,provider:'paper',recipients:[{name:'Recipient',email:'synthetic-locket-signer@example.test',action:'sign'}]})
 await requester.command('package.prepare',await packageInput(),{error:'NEEDS_PDF'})
 const bytes=pdf(v.text),before=v.digest
 await requester.command('version.rendition',{agreementId:created.id,version:(await current()).version,versionId:created.versionId,file:file('reviewed-word-rendition.pdf',bytes)})
 s=await h.owner.state();v=s.versions.find(v=>v.id===created.versionId)
 assert.notEqual(v.digest,before)
 assert.ok(s.approvals.filter(a=>a.agreement_id===created.id).every(a=>a.invalidated_at))
 await requester.command('package.prepare',await packageInput(),{error:'STATUS'})
 await approve()
 const packet=await requester.command('package.prepare',await packageInput())
 assert.deepEqual(Buffer.from(await(await requester.request(`/api/locket/files/${packet.pdfArtifactId}`)).arrayBuffer()),bytes)
 s=await h.owner.state()
 assert.ok(s.approvals.some(a=>a.agreement_id===created.id&&a.invalidated_at===null&&a.version_digest===v.digest))
 const original=s.artifacts.find(a=>a.version_id===v.id&&a.role==='original')
 assert.equal(original.media_type,'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
})
