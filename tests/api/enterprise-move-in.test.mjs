// One broad public-door journey for both new source kinds, with fakes only at
// the vendor network edge. No product handler or database result is mocked.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { installation } from './harness.mjs'
import { enterpriseFixture } from './enterprise-move-fixture.mjs'
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const batchOf=async(h,id)=>(await h.owner.state()).imports.find(b=>b.id===id)
const apply=async(h,dry)=>{for(let n=0;n<30;n++){const b=await batchOf(h,dry.batchId),r=await h.owner.command('import.apply',{batchId:b.id,version:b.version,fingerprint:b.fingerprint});if(r.status==='applied')return r}assert.fail('apply did not finish')}
const undo=async(h,id)=>{for(let n=0;n<30;n++){const b=await batchOf(h,id),r=await h.owner.command('import.undo',{batchId:b.id,version:b.version,reason:'Reviewed unused trial batch'});if(r.status==='undone')return r}assert.fail('undo did not finish')}

test('MOVE-003 moves ICI and Agiloft export/API cohorts through review, custody, families, confirmed current terms and guarded undo',async t=>{
  for(const kit of ['icertis','agiloft']) {
    const f=enterpriseFixture(kit),h=await installation({bindings:f.bindings,outboundResponse:f.outbound})
    try {
      await h.setTime(Date.UTC(2026,9,17,12))
      const viewer=await h.invite(`${kit}-viewer@example.test`,'viewer'), counsel=await h.invite(`${kit}-counsel@example.test`,'counsel')
      await viewer.command('import.preview',f.payload,{error:'FORBIDDEN'})
      const unauth=await h.request('/api/locket/commands',{method:'POST',body:{commandId:randomUUID(),type:'import.preview',payload:f.payload}});assert.equal(unauth.status,401)
      const dry=await h.owner.command('import.preview',f.payload)
      assert.equal(dry.counts.rows,30);assert.equal(dry.counts.import,29);assert.equal(dry.counts.missing,1);assert.equal(dry.counts.orphanFiles,1)
      let b=await batchOf(h,dry.batchId),review=JSON.parse(b.preview)
      assert.deepEqual(review.unmapped,['Business Unit','Risk Class','Region']);assert.equal((await h.owner.state()).agreements.length,0)
      await h.owner.command('import.apply',{batchId:b.id,version:b.version,fingerprint:b.fingerprint},{error:'IMPORT_MAPPING'})
      const field=await h.owner.command('field.save',{name:`${kit} Business Unit`,kind:'text',agreementTypes:['supplier','amendment'],requiredStages:[],editRoles:['owner','counsel','approver'],options:[]})
      const mapping={...review.mapping,'Business Unit':'custom:'+field.id,'Risk Class':'skip',Region:'skip'}
      const mapped=await h.owner.command('import.remap',{batchId:b.id,version:b.version,mapping})
      b=await batchOf(h,mapped.batchId);review=JSON.parse(b.preview)
      assert.equal(review.unmapped.length,0);assert.equal(review.mapping['Business Unit'],'custom:'+field.id)
      await h.owner.command('import.apply',{batchId:b.id,version:b.version,fingerprint:'changed'},{error:'FINGERPRINT'})
      const competing=await h.owner.command('import.preview',{...f.payload,mapping,label:'Concurrent reviewed source'})
      await apply(h,mapped)
      const staleBatch=await batchOf(h,competing.batchId)
      await h.owner.command('import.apply',{batchId:staleBatch.id,version:staleBatch.version,fingerprint:staleBatch.fingerprint},{error:'IMPORT_STALE'})
      let s=await h.owner.state();assert.equal(s.agreements.length,29);assert.equal(s.customValues.length,0);assert.equal(s.renewals.length,0);assert.equal(s.versions.filter(v=>v.number===2).length,1)
      const master=s.agreements.find(a=>a.title===`${kit} agreement 1`),amendments=s.agreements.filter(a=>a.parent_id===master.id)
      assert.equal(master.status,'imported');assert.equal(master.value_cents,null);assert.equal(amendments.length,2);assert.ok(amendments.every(a=>a.relation==='amends'))
      assert.ok(s.executions.every(e=>e.imported===1&&e.status==='needs_review'&&e.executed_on===''))
      for(const artifact of s.artifacts) {
        const path=JSON.parse(artifact.provenance).path,expected=f.files[path]
        assert.equal(artifact.sha256,sha(expected));const response=await h.owner.request('/api/locket/files/'+artifact.id)
        assert.equal(response.headers.get('x-locket-sha256'),sha(expected));assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected)
      }
      for(const row of f.rows.slice(0,29)) {
        const id=row['System ID']??row['Record ID'],search=await(await h.owner.request('/api/locket/search?q='+id)).json()
        assert.equal(search.results.length,1,`source identity ${id} is searchable`)
      }
      if(kit==='icertis')assert.equal((await(await h.owner.request('/api/locket/search?q=ICI-CODE-1')).json()).results.length,11)
      const archive=await(await h.owner.request('/api/locket/export')).json();assert.equal(archive.records.lk_import_batches.length,3);assert.ok(archive.records.lk_audit.some(a=>a.action==='import.apply'))
      s=await h.owner.state();assert.ok(s.audit.some(a=>a.action==='file.download'&&a.actor_id===s.actor.id))
      const again=await h.owner.command('import.preview',{...f.payload,mapping});assert.equal(again.counts.duplicate,29)
      await apply(h,again);assert.equal((await h.owner.state()).agreements.length,29)
      await undo(h,mapped.batchId);s=await h.owner.state();assert.equal(s.agreements.length,0);assert.equal(s.artifacts.length,0)
      assert.ok((await h.db.prepare('SELECT count(*) AS n FROM ik_originals WHERE job_id=?').bind(review.jobId).first()).n>50,'unused undo retains every source original')

      // The API path uses the same mapping and record identities, and records
      // real provider requests only at the external edge.
      const api=await h.owner.command('import.preview',{...f.payload,manifest:undefined,files:[],mapping,source:'api',consent:true,label:`${kit} API thirty`})
      assert.equal(api.counts.rows,30);assert.equal(api.counts.import,29);assert.equal(api.counts.missing,1)
      await apply(h,api);s=await h.owner.state();assert.equal(s.agreements.length,29)
      assert.equal(s.agreements.filter(a=>a.parent_id).length,2)
      for(const artifact of s.artifacts){const path=JSON.parse(artifact.provenance).path;assert.equal(artifact.sha256,sha(f.files[path]));assert.deepEqual(Buffer.from(await(await h.owner.request('/api/locket/files/'+artifact.id)).arrayBuffer()),f.files[path])}
      assert.ok((await h.db.prepare("SELECT count(*) AS n FROM ik_originals WHERE job_id=? AND name LIKE '_api/%'").bind(JSON.parse((await batchOf(h,api.batchId)).preview).jobId).first()).n>30)
      assert.ok(f.calls.every(c=>c.method==='GET'&&c.auth==='Bearer synthetic-read-only-token'))
      for(const op of kit==='agiloft'?['EWSelect','EWRead','EWAttachInfo','EWRetrieve']:['/ici/agreements','/ici/agreements/icertis-001/documents'])assert.ok(f.calls.some(c=>c.path===(op.startsWith('/')?op:'/'+op)))
      const apiBatch=await batchOf(h,api.batchId),apiReview=JSON.parse(apiBatch.preview)
      assert.equal(apiReview.api.release,f.profile.release)
      await undo(h,api.batchId);assert.equal((await h.owner.state()).agreements.length,0)
      f.setFailure('redirect');await h.owner.command('import.preview',{...f.payload,manifest:undefined,files:[],source:'api',consent:true},{error:'IMPORT_PROVIDER'});f.setFailure(null)
      assert.equal((await h.owner.state()).connections.find(c=>c.id===kit+'-import').status,'failing')
      const replay=await h.owner.command('import.preview',{...f.payload,mapping,restricted:true,source:'api',consent:true,label:'Restricted confirmed cohort'})
      await apply(h,replay);s=await h.owner.state()
      const root=s.agreements.find(a=>a.title===`${kit} agreement 1`),amendment=s.agreements.find(a=>a.title===`${kit} agreement 2`)
      assert.equal((await viewer.state()).agreements.length,0);assert.equal((await viewer.state()).imports.length,0)
      assert.equal((await(await viewer.request('/api/locket/search?q='+f.rows[0][kit==='icertis'?'System ID':'Record ID'])).json()).results.length,0)
      const file=s.artifacts.find(a=>a.agreement_id===root.id);assert.equal((await viewer.request('/api/locket/files/'+file.id)).status,404)
      const initialTerm=s.terms.find(t=>t.agreement_id===root.id&&t.key==='end_date')
      await counsel.command('term.decide',{agreementId:root.id,termId:initialTerm.id,decision:'confirm'},{error:'INVALID'})
      for(const agreement of [root,amendment])for(const term of s.terms.filter(t=>t.agreement_id===agreement.id&&!t.key.startsWith('import:')&&!t.key.startsWith('custom:')))await counsel.command('term.decide',{agreementId:agreement.id,termId:term.id,decision:'confirm',citation:{quote:'Auto renewal every 12 months. Notice 60 days.',page:1}})
      s=await h.owner.state();const current=s.renewalLifecycle?.terms??s.renewals;assert.ok(s.renewals.find(r=>r.agreement_id===root.id).deadline_date>'2026-10-17')
      const amount=s.terms.find(t=>t.agreement_id===root.id&&t.key==='import:value'),custom=s.terms.find(t=>t.agreement_id===root.id&&t.key==='custom:'+field.id)
      for(const term of [amount,custom])await counsel.command('import.value.confirm',{agreementId:root.id,termId:term.id,citation:{quote:'Amount USD 12000.50.',page:1}})
      s=await h.owner.state();assert.equal(s.agreements.find(a=>a.id===root.id).value_cents,1200050);assert.equal(JSON.parse(s.customValues.find(v=>v.agreement_id===root.id).value),'Operations')
      const source=s.terms.find(t=>t.agreement_id===amendment.id&&t.key==='end_date')
      assert.ok(JSON.parse(source.citation).quote);assert.equal(JSON.parse(source.citation).page,1)
      await counsel.command('family.term',{agreementId:root.id,version:s.agreements.find(a=>a.id===root.id).version,termId:source.id})
      const bulk=await h.owner.command('renewal.bulk.preview',{agreementIds:[root.id,amendment.id],ownerId:s.actor.id,offsets:[60,7]})
      assert.equal(bulk.tracked.length,2,JSON.stringify(bulk.skipped));assert.ok(bulk.tracked.every(r=>r.deadlineDate>'2026-10-17'))
      await h.owner.command('renewal.bulk.apply',{previewId:bulk.id})
      s=await h.owner.state();assert.equal(s.reminderSchedules.length,2)
      b=await batchOf(h,replay.batchId);await h.owner.command('import.undo',{batchId:b.id,version:b.version,reason:'Already used'},{error:'IMPORT_DEPENDENCY'})
      const stale=await counsel.command('term.propose',{agreementId:amendment.id,key:'end_date',value:'2028-03-31',citation:{quote:'Corrected date from signed clause',page:1}})
      await counsel.command('term.decide',{agreementId:amendment.id,termId:stale.id,decision:'confirm'})
      s=await h.owner.state();assert.equal(s.terms.find(t=>t.id===source.id).status,'superseded');assert.equal(s.familyTerms.find(t=>t.term_id===source.id).term_id,source.id)
      const recovered=await h.owner.command('import.preview',{...f.payload,manifest:undefined,files:[],mapping,source:'api',consent:true,label:'Read-only recovery'})
      assert.equal(recovered.counts.import,0);assert.equal((await h.owner.state()).connections.find(c=>c.id===kit+'-import').status,'healthy')
      const output=await(await h.owner.request('/api/locket/export')).json();assert.ok(output.records.lk_audit.some(a=>a.action==='import.value.confirm'));assert.ok(output.records.lk_audit.some(a=>a.action==='family.term'))
      assert.ok(!JSON.stringify(output).includes('synthetic-read-only-token'))
    } finally {await h.close()}
  }
})
