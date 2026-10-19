import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { productPage } from './product-harness.mjs'
import { familyFixture } from '../api/family-fixture.mjs'

test.use({ignoreHTTPSErrors:true,locale:'en-US',timezoneId:'America/New_York'})
for (const width of [1440,390]) test(`REPO-008 link MSA, orders and amendment and choose its governing end date at ${width}px`,async({page})=>{
  const runtime=await productPage(page,{width})
  try {
    const ids=await familyFixture(runtime.owner)
    const snapshot=async(name:string)=>{await page.evaluate(()=>scrollTo(0,0));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-repo-008-${name}.png`),fullPage:true})}}
    for(const [id,relation] of [[ids.first,'order_under'],[ids.second,'order_under'],[ids.amendment,'amends']]){
      await page.goto(runtime.origin+`/app#agreement/${id}/family`)
      await expect(page.getByRole('heading',{name:'Agreement family',exact:true})).toBeVisible()
      await page.getByLabel('Parent document',{exact:true}).selectOption(ids.master)
      await page.getByLabel('Relation',{exact:true}).selectOption(relation)
      await page.getByRole('button',{name:'Save family link',exact:true}).click()
      await expect(page.getByRole('status').filter({hasText:'Saved.'})).toBeVisible()
    }
    await page.goto(runtime.origin+`/app#agreement/${ids.master}/family`)
    await expect(page.locator('[data-family-member]')).toHaveCount(4)
    expect(await page.locator('[data-family-member]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-family-member')))).toEqual([ids.master,ids.first,ids.second,ids.amendment])
    await page.getByLabel('Confirmed source term',{exact:true}).selectOption(ids.termId)
    await page.getByRole('button',{name:'Select governing term',exact:true}).click()
    const term=page.locator('[data-governing-key="end_date"]')
    await expect(term).toContainText('2028');await expect(term).toContainText('Northwind term extension')
    await expect(term).toContainText('Term ends December 31, 2028.')
    await snapshot('governing')
    await term.getByRole('link').click()
    await expect(page.getByRole('heading',{name:'Terms',exact:true})).toBeVisible()
    await snapshot('source')
    const requester=await runtime.h.invite(`reader-${width}@example.test`,'requester')
    await page.context().clearCookies()
    await page.context().addCookies(requester.cookie.split('; ').map((pair:string)=>{const at=pair.indexOf('=');return {name:pair.slice(0,at),value:pair.slice(at+1),url:runtime.origin,secure:true,httpOnly:true,sameSite:'Lax' as const}}))
    await page.goto(runtime.origin+`/app#agreement/${ids.master}/family`)
    await expect(page.locator('[data-family-member]')).toHaveCount(4)
    await page.reload()
    await expect(page.getByRole('button',{name:'Save family link'})).toHaveCount(0)
    await expect(page.getByRole('button',{name:'Select governing term'})).toHaveCount(0)
    await snapshot('requester')
  }finally{await runtime.close()}
})
