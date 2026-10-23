import { test,expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { clauseSession } from './clause-session.mjs'
import { uploadedWordReview } from '../api/word-review-fixture.mjs'
test.use({ignoreHTTPSErrors:true})
for(const width of [1440,390])test(`Word tracks twelve changes, nine accepts and three rejects, retained replies and cleaned outputs at ${width}px`,async({page})=>{
 const p=await clauseSession(page,width)
 const shot=async(name:string)=>{expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-word-${name}.png`),fullPage:true})}}
 const save=async(type:string,button:any)=>{const pending=page.waitForResponse(response=>response.url()===p.origin+'/api/locket/commands'&&response.request().method()==='POST'&&response.request().postDataJSON().type===type);await button.click();expect((await(await pending).json()).ok).toBe(true)}
 try{
  const x=await uploadedWordReview(p),state=await p.owner.state()
  await page.goto(`${p.origin}/app#agreement/${x.a.id}`)
  const panel=page.getByRole('region',{name:'Word tracked changes',exact:true})
  await expect(panel.getByRole('list',{name:'Word revisions'}).locator('> li')).toHaveCount(12)
  await expect(panel).toContainText('Alicia Counsel');await expect(panel).toContainText('Morgan Supplier')
  await panel.getByText('Word comment positions',{exact:true}).click()
  await expect(panel.getByRole('list',{name:'Word comments'}).locator('> li')).toHaveCount(4)
  await shot('imported')
  const root=state.comments.find((row:any)=>row.version_id===x.uploaded.versionId&&row.body===x.commentBodies[0]),threads=page.getByRole('region',{name:'Comment threads'}),thread=threads.locator(`[data-thread="${root.id}"]`)
  await thread.getByLabel('Reply to thread',{exact:true}).fill('Our reply: the 30-day payment period is agreed.')
  await save('comment.add',thread.getByRole('button',{name:'Reply',exact:true}))
  await expect(thread.getByRole('list',{name:'Thread replies'})).toContainText('Our reply:')
  await shot('reply')
  for(const [id,choice]of Object.entries(x.decisions))await panel.getByLabel(`Decision for Word change ${id}`,{exact:true}).selectOption(String(choice))
  await save('word.review',panel.getByRole('button',{name:'Save Word decisions',exact:true}))
  await expect(page).toHaveURL(/versions\/3$/);await expect(panel).toContainText('0 Word revisions · 5 embedded comments')
  await panel.getByText('Write an attributed Word edit',{exact:true}).click()
  await panel.getByLabel('Word edit start',{exact:true}).fill('0');await panel.getByLabel('Word edit end',{exact:true}).fill('1');await panel.getByLabel('Word replacement',{exact:true}).fill('One')
  await save('word.review',panel.getByRole('button',{name:'Save tracked Word edit',exact:true}))
  await expect(page).toHaveURL(/versions\/4$/);await expect(panel).toContainText('2 Word revisions')
  await expect(panel.getByRole('list',{name:'Word revisions'})).toContainText(state.actor.name)
  const sharing=page.getByRole('region',{name:'Counterparty exchange',exact:true})
  await sharing.getByText('Review sharing permissions',{exact:true}).click()
  const externalComment=sharing.locator('.lk-card').filter({hasText:'Our reply:'})
  await externalComment.getByRole('checkbox').check();await save('comment.audience',externalComment.getByRole('button',{name:'Share comment externally',exact:true}))
  await panel.getByText('Prepare clean or redline Word',{exact:true}).click()
  await expect(panel.getByRole('note')).toContainText('Internal comments and document metadata will be removed')
  await panel.getByRole('checkbox',{name:'I approve removing internal comments and metadata from this Word output',exact:true}).check()
  for(const kind of ['redline','clean']){await panel.getByLabel('Word output',{exact:true}).selectOption(kind);await save('word.output',panel.getByRole('button',{name:'Prepare outgoing Word',exact:true}));await expect(panel.getByRole('link',{name:`Download ${kind} Word`,exact:true})).toBeVisible()}
  const download=page.waitForEvent('download');await panel.getByRole('link',{name:'Download clean Word',exact:true}).click();expect((await download).suggestedFilename()).toContain('-clean.docx')
  await shot('outputs')
  // The actual icon-only fold control, if text comparison has an unchanged section.
  const icon=page.getByRole('button',{name:/^Show \d+ unchanged paragraph/}).first()
  await expect(icon).toBeVisible();await icon.focus();await expect(page.getByRole('tooltip',{name:'Show unchanged'})).toBeVisible();await shot('tooltip-focus');await icon.blur();await icon.hover();await expect(page.getByRole('tooltip',{name:'Show unchanged'})).toBeVisible({timeout:1000});await shot('tooltip-hover')
 }finally{await p.close()}
})
