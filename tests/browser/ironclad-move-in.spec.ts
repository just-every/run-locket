import {test,expect} from '@playwright/test'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {productPage} from './product-harness.mjs'
import {ironcladArchive,entity,passage} from '../fixtures/ironclad/archive.mjs'

test.use({ignoreHTTPSErrors:true,locale:'en-US',timezoneId:'America/New_York'})
test('MOVE-002 owner reviews editable Ironclad mappings, imports fifty originals and cites terms before current-term scheduling',async({page})=>{
  test.setTimeout(300_000)
  const p=await productPage(page,{width:1440,bindings:{TEST_NOW:String(Date.parse('2026-10-29T12:00:00Z'))}})
  const fixture=ironcladArchive()
  const output=process.env.LOCKET_SCREENSHOTS
  const capture=async(name:string)=>{
    if(!output)return
    await mkdir(output,{recursive:true})
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:1000})
      await page.evaluate(()=>{window.scrollTo(0,0);document.querySelectorAll('textarea').forEach(t=>t.scrollTop=0)})
      await page.screenshot({path:join(output,`${width}-move-002-${name}.png`),fullPage:true})
    }
    await page.setViewportSize({width:1440,height:1000})
  }
  try{
    await p.command('entity.save',entity)
    await page.goto(p.origin+'/app#imports')
    await page.getByLabel('Move-in kit',{exact:true}).selectOption('ironclad-records')
    await page.getByLabel('Batch name',{exact:true}).fill('Ironclad cutover review')
    await page.getByLabel('Repository metadata',{exact:true}).setInputFiles({name:'records.csv',mimeType:'text/csv',buffer:Buffer.from(fixture.csv)})
    await page.getByLabel('Attachments ZIP',{exact:true}).setInputFiles({name:'attachments.zip',mimeType:'application/zip',buffer:fixture.archive})
    await page.getByRole('button',{name:'Inspect Ironclad source',exact:true}).click()
    const mapping=page.getByRole('region',{name:'Ironclad mapping',exact:true})
    await expect(mapping).toContainText('50 records · 51 supplied files')
    await expect(mapping).toContainText('Initially unmapped: Business Unit, Cost Center, Legacy Flag.')
    await mapping.getByLabel('Record type: Master Services Agreement',{exact:true}).selectOption('supplier')
    await mapping.getByRole('button',{name:'Create custom text field for Business Unit',exact:true}).click()
    await mapping.getByLabel('Property: Cost Center',{exact:true}).selectOption('skip')
    await mapping.getByLabel('Property: Legacy Flag',{exact:true}).selectOption('skip')
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
    await capture('mapping')
    await mapping.getByRole('button',{name:'Review Ironclad dry run',exact:true}).click()
    await expect(page.getByText('Files not in the report (not imported): unmatched/extra.pdf',{exact:true})).toBeVisible()
    await expect(page.getByRole('button',{name:'Apply this dry run (50 agreements)',exact:true})).toBeVisible()
    expect((await p.state()).agreements).toHaveLength(0)
    await capture('reviewed-dry-run')
    await page.getByRole('button',{name:'Apply this dry run (50 agreements)',exact:true}).click()
    for(let i=0;i<12;i++){
      const state=await p.state(),batch=state.imports.find((b:any)=>b.source_label==='Ironclad cutover review')
      if(batch?.status==='applied')break
      await page.getByRole('button',{name:/Continue reviewed import/}).click()
    }
    await expect.poll(async()=> (await p.state()).agreements.length).toBe(50)
    let s=await p.state()
    const root=s.agreements.find((a:any)=>a.type==='supplier')
    const end=s.terms.find((t:any)=>t.agreement_id===root.id&&t.key==='end_date')
    await page.goto(p.origin+`/app#agreement/${root.id}/terms`)
    const row=page.getByRole('row').filter({has:page.getByRole('cell',{name:'End date',exact:true})})
    await row.getByText('Confirm with citation',{exact:true}).click()
    await row.getByLabel('Words from the original document',{exact:true}).fill(passage)
    await row.getByLabel('Original document page',{exact:true}).fill('1')
    await capture('cited-term')
    await row.getByRole('button',{name:'Confirm imported term',exact:true}).click()
    await expect.poll(async()=> (await p.state()).terms.find((t:any)=>t.id===end.id).status).toBe('confirmed')
    for(const term of s.terms.filter((t:any)=>t.agreement_id===root.id&&t.id!==end.id))await p.command('term.decide',{agreementId:root.id,termId:term.id,decision:'confirm',citation:{quote:passage,page:1}})
    for(const [key,value]of [['governing_law','New York'],['payment_terms','Net 30']]){const t=await p.command('term.propose',{agreementId:root.id,key,value,citation:{quote:passage,page:1}});await p.command('term.decide',{agreementId:root.id,termId:t.id,decision:'confirm'})}
    s=await p.state()
    const preview=await p.command('renewal.bulk.preview',{agreementIds:s.agreements.map((a:any)=>a.id),ownerId:s.actor.id,offsets:[30,7]})
    expect(preview.tracked).toHaveLength(1);expect(preview.skipped).toHaveLength(49)
    expect(preview.tracked[0].end).toBe('2027-02-28')
    await p.command('renewal.bulk.apply',{previewId:preview.id})
    await page.reload()
    await expect(page.getByRole('heading',{name:'Terms',exact:true})).toBeVisible()
    await capture('confirmed-current-term')
    await page.goto(p.origin+`/app#agreement/${root.id}/family`)
    await page.waitForTimeout(300)
    await capture('family')
    const artifact=s.artifacts.find((f:any)=>f.agreement_id===root.id&&f.role==='signed')
    const downloaded=await p.owner.request('/api/locket/files/'+artifact.id)
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(fixture.documents.find(([path]:any)=>path.startsWith(artifact.source_id+'/'))![1])
  }finally{await p.close()}
})
