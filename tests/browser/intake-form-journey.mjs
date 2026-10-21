import { expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pdf, file } from '../api/files.mjs'
import { supplierForm } from '../api/intake-form-fixture.mjs'

export async function intakeFormJourney(page,width,p) {
  const tag=randomUUID().slice(0,6),owner=p.owner,state=await owner.state(),ownerId=state.actor.id
  const outside=p.h ? await p.h.invite(`outside-${tag}@example.test`,'requester') : null
  const counsel=p.h ? await p.h.invite(`counsel-${tag}@example.test`,'counsel') : null
  const reviewerId=counsel?.id ?? ownerId
  const shot=async name=>{
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
    if(process.env.LOCKET_SCREENSHOTS) {await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-INTAKE-002-${name}.png`),fullPage:true})}
  }
  const run=async action=>{
    const response=page.waitForResponse(r=>r.url()===p.origin+'/api/locket/commands'&&r.request().method()==='POST')
    await action();const body=await(await response).json();expect(body.ok,JSON.stringify(body.error)).toBe(true)
    await expect(page.locator('main')).toHaveAttribute('aria-busy','false')
    return body.result
  }
  await page.goto(p.origin+'/app#library');await page.reload()
  const audiences=page.locator('section').filter({has:page.getByRole('heading',{name:'Intake groups and departments',exact:true})}).last()
  await audiences.getByText('Manage intake membership',{exact:true}).click()
  const groupName=`Procurement ${tag}`
  await audiences.getByLabel('Name',{exact:true}).fill(groupName)
  await audiences.locator(`input[name="memberId"][value="${ownerId}"]`).check()
  const group=await run(()=>audiences.getByRole('button',{name:'Create group or department',exact:true}).click())
  await expect(audiences).toContainText(groupName)
  await shot('procurement-membership')
  // A published first version creates an in-flight request; the browser authors its replacement.
  const formName=`Supplier procurement ${tag}`
  const def=supplierForm({ownerId,reviewerId,audienceId:group.id,name:formName,highRole:'approver'})
  const firstDraft=await owner.command('form.save',{definition:def})
  const first=await owner.command('form.publish',firstDraft)
  const early=await owner.command('request.create',{title:`In flight ${tag}`,type:'supplier',party:{name:`Existing supplier ${tag}`,kind:'supplier'},value:'60000',formVersionId:first.versionId,formAnswers:{security:'Enhanced review'},file:file('existing.pdf',pdf('Existing supplier agreement '+tag)),text:'Existing supplier agreement '+tag})
  const original=(await owner.state()).requestForms.find(f=>f.agreement_id===early.id)
  await page.reload()
  const designer=page.locator('section').filter({has:page.getByRole('heading',{name:'Request form designer',exact:true})}).last()
  await designer.getByLabel('Form to configure',{exact:true}).selectOption(firstDraft.id)
  await designer.getByLabel('Form name',{exact:true}).fill(formName)
  // Add and configure the conditional question through the visual designer.
  const question=designer.getByRole('group',{name:'Question 1',exact:true})
  await question.getByLabel('Question 1 label',{exact:true}).fill('Security questionnaire needed')
  await question.getByLabel('Question 1 type',{exact:true}).selectOption('pick_list')
  await question.getByLabel('Question 1 options',{exact:true}).fill('Standard review\nEnhanced review')
  await question.getByLabel('Required when visible',{exact:true}).check()
  const condition=question.getByRole('group',{name:'Condition 1',exact:true})
  await condition.getByLabel('Answer to compare',{exact:true}).selectOption('value')
  await condition.getByLabel('Comparison',{exact:true}).selectOption('gt')
  await condition.getByLabel('Comparison value',{exact:true}).fill('50000')
  const rule=designer.getByRole('group',{name:'Rule 1',exact:true})
  await rule.getByLabel('Approval role',{exact:true}).selectOption('counsel')
  await rule.getByLabel('Reviewer',{exact:true}).selectOption(reviewerId)
  await rule.getByLabel('Rule 1 additional attachments',{exact:true}).fill('Security questionnaire')
  await designer.getByRole('group',{name:'Who can launch this form',exact:true}).getByLabel(`${groupName} (group)`,{exact:true}).check()
  await run(()=>designer.getByRole('button',{name:'Save draft',exact:true}).click())
  await shot('draft-designer')
  await designer.getByLabel('Sample agreement value (USD)',{exact:true}).fill('49000')
  await expect(designer.getByLabel('Security questionnaire needed',{exact:true})).toHaveCount(0)
  await run(()=>designer.getByRole('button',{name:'Preview sample',exact:true}).click())
  const preview=designer.getByRole('status').filter({has:page.getByRole('heading',{name:'Sample route',exact:true})})
  await expect(preview).toContainText('Default route')
  await expect(preview).toContainText('Approver')
  await expect(preview).not.toContainText('Security questionnaire')
  await shot('below-threshold-preview')
  await designer.getByLabel('Sample agreement value (USD)',{exact:true}).fill('60000')
  await expect(designer.getByLabel('Security questionnaire needed',{exact:true})).toBeVisible()
  await designer.getByLabel('Security questionnaire needed',{exact:true}).selectOption('Enhanced review')
  await run(()=>designer.getByRole('button',{name:'Preview sample',exact:true}).click())
  await expect(preview).toContainText('High value counsel')
  await expect(preview).toContainText('Counsel')
  await expect(preview).toContainText('Security questionnaire')
  await shot('above-threshold-preview')
  const published=await run(()=>designer.getByRole('button',{name:'Publish form',exact:true}).click())
  await expect(designer.getByText('Form published. Selected people can now launch this version.',{exact:true})).toBeVisible()
  await shot('published-form')
  expect((await owner.state()).requestForms.find(f=>f.agreement_id===early.id)).toEqual(original)
  for(const [amount,role] of [['49000','approver'],['60000','counsel']]) {
    await page.goto(p.origin+'/app#new');await page.reload()
    await page.getByLabel('Request form',{exact:true}).selectOption(firstDraft.id)
    await page.getByLabel('Agreement title *',{exact:true}).fill(`Supplier ${amount} ${tag}`)
    await page.getByLabel('Agreement value (USD)',{exact:true}).fill(amount)
    const intake=page.locator('.lk-intake-form')
    await intake.getByLabel('Counterparty',{exact:true}).selectOption((await owner.state()).parties.find(p=>p.name===`Existing supplier ${tag}`).id)
    if(role==='counsel') await intake.getByLabel('Security questionnaire needed *',{exact:true}).selectOption('Enhanced review')
    else await expect(intake.getByLabel('Security questionnaire needed *',{exact:true})).toHaveCount(0)
    await page.getByLabel('Attach draft',{exact:true}).check()
    await page.getByLabel('Draft (PDF or DOCX)',{exact:true}).setInputFiles({name:`Supplier ${amount}.pdf`,mimeType:'application/pdf',buffer:pdf(`Supplier agreement ${amount} ${tag}`)})
    await page.getByLabel('Text (optional for PDF)',{exact:true}).fill(`Supplier agreement ${amount} ${tag}`)
    await shot(`${role}-request`)
    const created=await run(()=>page.getByRole('button',{name:'Create request',exact:true}).click())
    await expect(page).toHaveURL(new RegExp(`agreement/${created.id}`))
    const snapshot=page.getByRole('region',{name:'Published request route',exact:true})
    await expect(snapshot).toContainText('v2')
    await expect(snapshot).toContainText(role==='counsel'?'Counsel':'Approver')
    // Required files are attached through the same request's ordinary public attachment commands.
    const s=await owner.state()
    expect(s.requestForms.find(f=>f.agreement_id===created.id).form_version_id).toBe(published.versionId)
    for(const r of s.requirements.filter(r=>r.agreement_id===created.id)) await owner.command('requirement.attach',{agreementId:created.id,requirementId:r.id,file:file(r.label+'.pdf',pdf(r.label))})
    await page.reload()
    await run(()=>page.getByRole('button',{name:'Submit for review',exact:true}).click())
    await page.goto(p.origin+`/app#agreement/${created.id}/approvals`)
    await expect(page.getByRole('heading',{name:/Approval route for/})).toBeVisible()
    await expect(page.locator('.lk-route')).toContainText(role==='counsel'?'Counsel approval':'Commercial approval')
    await shot(`${role}-submitted-route`)
  }
  await page.goto(p.origin+`/app#agreement/${early.id}/approvals`);await page.reload()
  await expect(page.getByRole('region',{name:'Published request route',exact:true})).toContainText('v1')
  await expect(page.locator('.lk-route')).toContainText('Commercial approval')
  await shot('inflight-original-route')
  if(outside) {
    await page.context().clearCookies()
    await page.context().addCookies(outside.cookie.split('; ').map(pair=>{const at=pair.indexOf('=');return {name:pair.slice(0,at),value:pair.slice(at+1),url:p.origin,secure:true,httpOnly:true,sameSite:'Lax'}}))
  } else {
    await owner.command('audience.save',{id:group.id,version:group.version,name:groupName,kind:'group',memberIds:[]})
  }
  await page.goto(p.origin+'/app#new');await page.reload()
  await expect(page.getByRole('heading',{name:'New agreement request',exact:true})).toBeVisible()
  await expect(page.getByLabel('Request form',{exact:true}).locator('option').filter({hasText:formName})).toHaveCount(0)
  const refused=await page.request.post(p.origin+'/api/locket/commands',{headers:{origin:p.origin},data:{commandId:randomUUID(),type:'request.create',payload:{title:'Forbidden launch',type:'supplier',party:{name:'Forbidden supplier',kind:'supplier'},value:'60000',formVersionId:published.versionId,formAnswers:{security:'Enhanced review'}}}})
  expect(refused.status()).toBe(403)
  expect((await refused.json()).error.code).toBe('FORBIDDEN')
  await shot('outside-procurement')
}
