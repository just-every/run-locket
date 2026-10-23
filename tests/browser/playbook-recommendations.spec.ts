import { file,pdf } from '../api/files.mjs'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { negotiationFixture } from '../api/playbook-recommendation-fixture.mjs'
import { reconciliationBindings,reconciliationFake } from '../api/reconciliation-fixture.mjs'
import { serviceLevelBindings,serviceLevelFake } from '../api/service-level-fixture.mjs'

test.use({ ignoreHTTPSErrors: true, locale: 'en-US', timezoneId: 'America/New_York' })

for (const width of [1440, 390]) test(`AGENT-007 counsel reviews thirty negotiations and twenty-two citations, then scopes a new playbook at ${width}px`, async ({ page }) => {
  const accountingEdge=reconciliationFake([]),uptimeEdge=serviceLevelFake([])
  const outboundResponse=async(request:Request)=>{
    if(new URL(request.url).hostname.endsWith('intuit.com'))return accountingEdge(request)
    const response=await uptimeEdge(request),body=await response.json()
    body.generatedAt=Date.parse('2026-10-26T00:00:00Z')
    return Response.json(body)
  }
  const p = await productPage(page, { width,bindings:{...reconciliationBindings,...serviceLevelBindings,TEST_NOW:String(Date.parse('2026-10-23T12:00:00Z'))},outboundResponse })
  try {
    const f = await negotiationFixture(p.h,{nativeCredit:true})
    await page.context().clearCookies()
    await page.context().addCookies(f.counsel.cookie.split('; ').map((pair: string) => {
      const i = pair.indexOf('=')
      return { name: pair.slice(0, i), value: pair.slice(i + 1), url: p.origin, secure: true, httpOnly: true, sameSite: 'Lax' as const }
    }))
    await page.goto(p.origin + '/app#library')
    const panel = page.getByRole('region', { name: 'Measured playbook changes', exact: true })
    await expect(panel).toBeVisible()
    await panel.getByText('Analyze accepted exceptions', { exact: true }).click()
    await panel.getByRole('checkbox', { name: 'Supplier', exact: true }).check()
    await panel.getByRole('button', { name: 'Prepare measured recommendation', exact: true }).click()
    const recommendation = panel.getByRole('article', { name: 'Recommendation liability', exact: true })
    await expect(recommendation).toBeVisible()
    const state = await f.counsel.state()
    const r = state.playbookRecommendations.recommendations[0]
    const analysis = JSON.parse(r.analysis)
    expect(analysis.negotiations).toBe(30)
    expect(analysis.citations).toHaveLength(22)
    await expect(recommendation).toContainText(`${analysis.acceptedCount} accepted citations from ${analysis.negotiations} recorded negotiations`)
    await expect(recommendation).toContainText(`${(analysis.cycleTime.predictedSavingMs / 3_600_000).toLocaleString('en-US', { maximumFractionDigits: 2 })} hours`)
    await recommendation.getByText('Affected agreements and exact citations (22)', { exact: true }).click()
    await expect(recommendation.getByRole('link')).toHaveCount(analysis.citations.length+analysis.creditEvidence.length)
    await expect(recommendation.getByRole('link',{name:/Credit source/})).toHaveCount(3)
    await expect(recommendation).toContainText('USD 4,000.00')
    await expect(recommendation).toContainText('USD 1,000.00')
    await expect(recommendation).toContainText('USD 1,500.00')
    await expect(recommendation).toContainText('No supplier send recorded.')
    for (const citation of analysis.citations) await expect(recommendation.getByRole('link', { name: `${citation.title} · v${citation.version}`, exact: true })).toHaveAttribute('href', `#agreement/${citation.agreementId}/versions/${citation.version}/${citation.start}/${citation.end}`)
    await expect(recommendation).toContainText(analysis.citations.find((c: any) => c.issues.length).issues[0].description)
    if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await recommendation.locator('li').filter({hasText:'USD 4,000.00'}).first().screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-agent-007-native-credit-evidence.png`)})}
    await recommendation.getByText('Affected agreements and exact citations (22)', { exact: true }).click()
    if (process.env.LOCKET_SCREENSHOTS) {
      await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
      await panel.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-agent-007-measured-recommendation.png`) })
    }
    await recommendation.getByRole('checkbox').check()
    await recommendation.getByLabel('Counsel decision reason', { exact: true }).fill('Reviewed the credit and unknown observations; approve for future supplier reviews only.')
    await recommendation.getByRole('button', { name: 'Approve new playbook version', exact: true }).click()
    await expect(recommendation.getByRole('button', { name: 'Approve new playbook version', exact: true })).toHaveCount(0)
    const after = await f.counsel.state()
    const approved = after.playbookRecommendations.recommendations.find((x: any) => x.id === r.id)
    expect(approved.status).toBe('approved')
    expect(after.playbookRecommendations.applications.find((x: any) => x.id === approved.new_playbook_id).scope).toBe(JSON.stringify(f.scope))
    expect(after.deviations.find((d: any) => d.id === f.rows[0].findingId).playbook_version_id).toBe(f.source.id)
    expect(after.agreements.find((a: any) => a.id === f.rows[0].id).status).toBe('executed')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    if (process.env.LOCKET_SCREENSHOTS) await panel.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-agent-007-approved-scope.png`) })
    await recommendation.getByText('Affected agreements and exact citations (22)', { exact: true }).click()
    await recommendation.getByRole('link', { name: `${analysis.citations[0].title} · v${analysis.citations[0].version}`, exact: true }).click()
    await expect(page.locator('[data-search-hit]')).toContainText(analysis.citations[0].quote)
    await page.goto(`${p.origin}/app#agreement/${f.rows[0].id}/review`)
    await expect(page.getByRole('heading',{name:'Review findings',exact:true})).toBeVisible()
    await expect(page.locator('.lk-findings')).toContainText(`playbook v${after.playbooks.find((book:any)=>book.id===f.source.id).number}`)
    if(process.env.LOCKET_SCREENSHOTS)await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-agent-007-historical-finding.png`),fullPage:true})
    for(const type of ['supplier','nda']){
      const body='Liability is capped at the fees paid in the prior 24 months.'
      const a=await p.command('request.create',{title:`Northwind future ${type} review`,type,party:{name:'Northwind Services',kind:'supplier'},file:file('future-review.pdf',pdf(body)),text:body})
      await page.goto(`${p.origin}/app#agreement/${a.id}/review`)
      await page.reload()
      const version=after.playbooks.find((book:any)=>book.id===(type==='supplier'?approved.new_playbook_id:f.source.id))
      await expect(page.getByRole('heading',{name:'Review findings',exact:true})).toBeVisible()
      await page.getByText(`Playbook v${version.number} rules (1)`,{exact:true}).click()
      if(type==='supplier')await expect(page.locator('.lk-rules')).toContainText(body)
      else await expect(page.locator('.lk-rules')).not.toContainText(body)
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
      if(process.env.LOCKET_SCREENSHOTS)await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-agent-007-future-${type}-review.png`),fullPage:true})
    }
  } finally { await p.close() }
})
