import {expect} from '@playwright/test'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {repositoryBulkFixture,csvRecords,writeCsv} from '../api/repository-bulk-fixture.mjs'
export async function repositoryBulkBrowserJourney(page,width,p){
 const start=width*100,{ids}=await repositoryBulkFixture(p.owner,4,start)
 const department=await p.owner.command('audience.save',{name:'Sales '+width,kind:'department',memberIds:[]})
 await page.goto(p.origin+'/app#agreements');await page.reload()
 const panel=page.getByRole('region',{name:'Bulk repository actions',exact:true})
 await page.getByText('Bulk repository actions',{exact:true}).first().click()
 const shot=async(name)=>{
  await panel.scrollIntoViewIfNeeded()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-REPO-011-${name}.png`),fullPage:true})}
 }
 await panel.getByLabel('Select all matching agreements',{exact:true}).uncheck()
 for(let i=0;i<4;i++)await panel.getByLabel(`Select synthetic-locket-${start+i}`,{exact:true}).check()
 await panel.getByRole('button',{name:'Save bulk selection',exact:true}).click()
 await expect(panel.getByRole('status')).toContainText('4 selected')
 await panel.getByLabel('Bulk field',{exact:true}).selectOption('department')
 await panel.getByLabel('Bulk field value',{exact:true}).selectOption(department.id)
 await panel.getByRole('button',{name:'Preview field changes',exact:true}).click()
 await expect(panel.getByRole('status')).toContainText('4 changed in dry run')
 await expect(panel.getByRole('status')).toContainText('reviewed')
 expect((await p.owner.state()).agreementDepartments.filter(d=>ids.includes(d.agreement_id))).toHaveLength(0)
 await shot('department-dry-run')
 await panel.getByRole('button',{name:'Apply exact dry run',exact:true}).click()
 await expect(panel.getByRole('status')).toContainText('4 applied')
 expect((await p.owner.state()).agreementDepartments.filter(d=>ids.includes(d.agreement_id)&&d.department_id===department.id)).toHaveLength(4)
 await shot('applied')
 await panel.getByRole('button',{name:'Revert bulk operation',exact:true}).click()
 await expect(panel.getByRole('button',{name:'Continue restoring prior values',exact:true})).toBeEnabled()
 await panel.getByRole('button',{name:'Continue restoring prior values',exact:true}).click()
 await expect(panel.getByRole('status')).toContainText('4 reverted')
 expect((await p.owner.state()).agreementDepartments.filter(d=>ids.includes(d.agreement_id))).toHaveLength(0)
 await shot('restored-history')
 await panel.getByRole('button',{name:'Save bulk selection',exact:true}).click()
 await expect(panel.getByRole('status')).toContainText('selected')
 const downloaded=page.waitForEvent('download')
 await panel.getByRole('link',{name:'Export metadata CSV',exact:true}).click()
 const download=await downloaded,stream=await download.createReadStream(),chunks=[]
 for await(const chunk of stream)chunks.push(chunk)
 const csv=csvRecords(Buffer.concat(chunks).toString()),type=csv[0].indexOf('type');csv[1][type]='nda'
 await panel.getByText('Re-import corrected metadata CSV',{exact:true}).click()
 await panel.getByLabel('Metadata CSV',{exact:true}).fill(writeCsv(csv))
 await panel.getByRole('button',{name:'Preview CSV changes',exact:true}).click()
 await expect(panel.getByRole('status')).toContainText('1 changed in dry run')
 await expect(panel.getByRole('status')).toContainText('reviewed')
 await shot('csv-exact-difference')
 await panel.getByRole('button',{name:'Apply exact dry run',exact:true}).click()
 await expect(panel.getByRole('status')).toContainText('1 applied')
 expect((await p.owner.state()).agreements.filter(a=>ids.includes(a.id)&&a.type==='nda')).toHaveLength(1)
 await shot('csv-applied')
 const current=await p.owner.state()
 for(const id of ids){expect(current.audit.some(a=>a.agreement_id===id&&a.action==='repository.bulk.apply')).toBe(true);expect(current.audit.some(a=>a.agreement_id===id&&a.action==='repository.bulk.revert')).toBe(true)}
}
