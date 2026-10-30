import { test, expect } from '@playwright/test'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { productPage } from './product-harness.mjs'
import { enterpriseFixture } from '../api/enterprise-move-fixture.mjs'

test.use({ignoreHTTPSErrors:true})
test('MOVE-003 reviews editable source mappings, applies original custody and shows imported families at desktop and phone widths',async({page})=>{
  test.setTimeout(300_000)
  const runtime=await productPage(page,{width:1440}),directory=await mkdtemp(join(tmpdir(),'locket-move-ui-'))
  try {
    const snapshot=async(name:string)=>{
      if(process.env.LOCKET_SCREENSHOTS) {
        await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true})
        for(const width of [1440,390]) {
          await page.setViewportSize({width,height:1000});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-move-003-${name}.png`),fullPage:true})
        }
        await page.setViewportSize({width:1440,height:1000})
      }
    }
    for(const kit of ['icertis','agiloft']) {
      const f=enterpriseFixture(kit)
      await page.goto(runtime.origin+'/app#imports')
      await expect(page.getByRole('heading',{name:'Move from Icertis or Agiloft'})).toBeVisible()
      const form=page.locator('form').filter({has:page.getByLabel('Source system',{exact:true})})
      await form.getByLabel('Source system').selectOption(kit)
      await form.getByLabel('Batch name',{exact:true}).fill(kit+' browser import')
      await form.getByLabel('Metadata export (XLSX or CSV)').setInputFiles({name:kit+'.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(f.payload.manifest.base64,'base64')})
      const root=join(directory,kit)
      for(const [path,bytes] of Object.entries(f.files)){const target=join(root,path);await mkdir(join(target,'..'),{recursive:true});await writeFile(target,bytes as Uint8Array)}
      await form.getByLabel('Documents folder',{exact:true}).setInputFiles(root)
      await form.getByRole('button',{name:'Review source',exact:true}).click()
      await expect(page.getByText(/30 source records · 0 to import/)).toBeVisible()
      await expect(page.getByText(/Unmapped fields:/)).toContainText('Business Unit')
      await snapshot(kit+'-mapping')
      await page.reload();await expect(page.getByRole('button',{name:'Review revised mapping',exact:true})).toBeVisible()
      const mappings=page.locator('form').filter({has:page.getByRole('button',{name:'Review revised mapping',exact:true})})
      for(const column of ['Business Unit','Risk Class','Region',...(kit==='icertis'?['First Party']:[])])await mappings.getByLabel('Map '+column,{exact:true}).selectOption('skip')
      await mappings.getByLabel('Contract type MSA',{exact:true}).selectOption('supplier')
      await mappings.getByLabel('Contract type Amendment',{exact:true}).selectOption('amendment')
      await mappings.getByLabel('Documents in signed_document',{exact:true}).selectOption('signed')
      await mappings.getByLabel('Documents in supporting_files',{exact:true}).selectOption('attachment')
      await mappings.getByRole('button',{name:'Review revised mapping',exact:true}).click()
      await expect(page.getByText('30 source records · 29 to import · 1 missing evidence · 0 duplicates · 0 unsigned or skipped',{exact:true})).toBeVisible()
      await expect(page.getByText(/Files without records:/)).toContainText('orphan.pdf')
      await snapshot(kit+'-review')
      await page.getByRole('button',{name:'Apply this dry run (29 agreements)',exact:true}).click()
      await expect(page.getByRole('button',{name:'Undo batch',exact:true})).toBeVisible({timeout:120_000})
      await snapshot(kit+'-applied')
      const state=await runtime.state(),master=state.agreements.find((a:any)=>a.title===kit+' agreement 1')
      expect(state.agreements.filter((a:any)=>a.title.startsWith(kit+' agreement'))).toHaveLength(29)
      await page.goto(runtime.origin+`/app#agreement/${master.id}/family`)
      await expect(page.locator('[data-family-member]')).toHaveCount(3)
      await snapshot(kit+'-family')
      await page.goto(runtime.origin+`/app#agreement/${master.id}/terms`)
      await expect(page.getByRole('heading',{name:'Terms',exact:true})).toBeVisible()
      await expect(page.locator('tr').filter({hasText:'Import manifest row'}).first()).toContainText('Proposed')
      await snapshot(kit+'-terms')
      const art=state.artifacts.find((a:any)=>a.agreement_id===master.id&&a.role==='signed')
      const downloaded=await runtime.owner.request('/api/locket/files/'+art.id)
      expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(f.files[JSON.parse(art.provenance).path])
      await page.goto(runtime.origin+'/app#imports')
      page.once('dialog',dialog=>dialog.accept('Unused browser trial'))
      await page.getByRole('button',{name:'Undo batch',exact:true}).click()
      await expect(page.getByText(/The journal and original files remain/)).toBeVisible({timeout:120_000})
      expect((await runtime.state()).agreements.filter((a:any)=>a.title.startsWith(kit+' agreement'))).toHaveLength(0)
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
      await snapshot(kit+'-undone')
    }
  }finally{await runtime.close();await rm(directory,{recursive:true,force:true})}
})
