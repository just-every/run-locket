import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { slackLaunch, launchToken } from '../api/chat-fixture.mjs'
import { productPage } from './product-harness.mjs'
import { file, pdf } from '../api/files.mjs'

test.use({ ignoreHTTPSErrors: true })
test(`NOTIFY-001 inbox, explicit mention, read state and personal channels at 1440px/390px`, async ({ page }) => {
  for (const width of [1440, 390]) {
    let close = async () => {}
    let origin: string, owner: any
    if (process.env.LOCKET_NOTIFICATION_LIVE) {
      origin = process.env.LOCKET_BASE_URL!
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(process.env.LOCKET_OPEN!)
      await page.waitForURL(url => !url.hash.includes('rer-dev') && ['/app', '/setup'].includes(url.pathname))
      if (new URL(page.url()).pathname === '/setup') {
        await page.getByRole('checkbox').check()
        await page.getByRole('button', { name: 'Finish setup', exact: true }).click()
        await page.waitForURL(url => url.pathname === '/app')
      }
      owner = {
        command: async (type: string, payload: object) => {
          const response = await page.request.post(origin + '/api/locket/commands', { headers: { origin }, data: { type, payload, commandId: randomUUID() } })
          const body = await response.json()
          expect(body.ok, JSON.stringify(body.error)).toBe(true)
          return body.result
        },
        state: async () => (await page.request.get(origin + '/api/locket/state')).json(),
      }
    } else {
      const product = await productPage(page, { width })
      close = () => product.close()
      origin = product.origin
      owner = product.owner
    }
    const commandResponse = (type: string) => page.waitForResponse(response => response.url() === origin + '/api/locket/commands' && response.request().method() === 'POST' && response.request().postDataJSON().type === type)
    const screenshot = async (name: string) => {
      if (!process.env.LOCKET_SCREENSHOTS) return
      await mkdir(process.env.LOCKET_SCREENSHOTS, { recursive: true })
      await page.screenshot({ path: join(process.env.LOCKET_SCREENSHOTS, `${width}-NOTIFY-001-${name}.png`), fullPage: true })
    }
    const fits = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    try {
      const initial = await owner.state()
      await owner.command('notification.preferences', { inApp: true, email: true, digest: false, timezone: 'America/New_York' })
      const tag = randomUUID().slice(0, 8)
      const agreement = await owner.command('request.create', {
        title: `Supplier confidentiality review ${tag}`, type: 'nda', ownerId: initial.actor.id,
        party: { name: `Westlake Supply ${tag}`, kind: 'supplier' },
        file: file(`confidentiality-${tag}.pdf`, pdf('Both parties will protect confidential information.')),
        text: 'Both parties will protect confidential information.',
      })
      await page.goto(`${origin}/app#agreement/${agreement.id}`)
      await page.reload()
      const comments = page.locator('section.lk-comments-card')
      await comments.getByLabel('Comment on v1', { exact: true }).fill('Please review the confidentiality wording before we submit this request.')
      await comments.getByRole('checkbox', { name: `Mention ${initial.actor.name}`, exact: false }).check()
      await fits()
      await screenshot('mention')
      const mentioned = commandResponse('comment.add')
      await comments.getByRole('button', { name: 'Comment', exact: true }).click()
      const commentReply = await (await mentioned).json()
      expect(commentReply.ok, JSON.stringify(commentReply.error)).toBe(true)
      await expect(comments.getByText('Please review the confidentiality wording before we submit this request.', { exact: true })).toBeVisible()
      await page.getByRole('navigation', { name: 'Locket', exact: true }).getByRole('link', { name: 'Notifications', exact: true }).click()
      const inbox = page.getByRole('region', { name: 'Notification inbox', exact: true })
      const assignment = inbox.getByRole('article', { name: 'Assignment notification', exact: true }).filter({ has: page.locator(`a[href*="${agreement.id}"]`) })
      const mention = inbox.getByRole('article', { name: 'Comment mention notification', exact: true }).filter({ has: page.locator(`a[href*="${agreement.id}"]`) })
      await expect(assignment).toBeVisible()
      await expect(mention).toBeVisible()
      await expect(mention.getByText('Unread', { exact: true })).toBeVisible()
      // Notifications expose only a generic link; agreement details stay behind it.
      await expect(inbox).not.toContainText(`Westlake Supply ${tag}`)
      await expect(inbox).not.toContainText('Please review the confidentiality wording')
      const read = commandResponse('notification.read')
      await mention.getByRole('button', { name: 'Mark as read', exact: true }).click()
      expect((await (await read).json()).ok).toBe(true)
      await expect(mention.getByText('Read', { exact: true })).toBeVisible()
      await inbox.getByRole('button', { name: /^Unread / }).click()
      await expect(mention).toHaveCount(0)
      await expect(assignment).toBeVisible()
      await inbox.getByRole('button', { name: /^All / }).click()
      await mention.getByRole('link', { name: 'Open agreement', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`#agreement/${agreement.id}`))
      await expect(comments.getByText('Please review the confidentiality wording before we submit this request.', { exact: true })).toBeVisible()
      await page.getByRole('navigation', { name: 'Locket', exact: true }).getByRole('link', { name: 'Notifications', exact: true }).click()
      const preferences = page.getByRole('region', { name: 'Notification preferences', exact: true })
      await preferences.getByLabel('In-app notifications', { exact: true }).uncheck()
      await preferences.getByLabel('Email notifications', { exact: true }).uncheck()
      await preferences.getByLabel('Daily email digest', { exact: true }).check()
      await preferences.getByLabel('Notification time zone', { exact: true }).selectOption('America/Los_Angeles')
      const saved = commandResponse('notification.preferences')
      await preferences.getByRole('button', { name: 'Save notification preferences', exact: true }).click()
      expect((await (await saved).json()).ok).toBe(true)
      await page.reload()
      await expect(preferences.getByLabel('In-app notifications', { exact: true })).not.toBeChecked()
      await expect(preferences.getByLabel('Email notifications', { exact: true })).not.toBeChecked()
      await expect(preferences.getByLabel('Daily email digest', { exact: true })).toBeChecked()
      await expect(preferences.getByLabel('Notification time zone', { exact: true })).toHaveValue('America/Los_Angeles')
      expect((await owner.state()).notifications.preferences).toEqual({ inApp: false, email: false, digest: true, timezone: 'America/Los_Angeles' })
      await preferences.getByLabel('In-app notifications', { exact: true }).check()
      await preferences.getByLabel('Email notifications', { exact: true }).check()
      const enabled = commandResponse('notification.preferences')
      await preferences.getByRole('button', { name: 'Save notification preferences', exact: true }).click()
      expect((await (await enabled).json()).ok).toBe(true)
      await expect(preferences.getByRole('button', { name: 'Save notification preferences', exact: true })).toBeEnabled()
      await expect.poll(async () => (await owner.state()).notifications.preferences).toEqual({ inApp: true, email: true, digest: true, timezone: 'America/Los_Angeles' })
      await expect(mention.getByText('Read', { exact: true })).toBeVisible()
      await fits()
      await screenshot('inbox-preferences')
      await page.goto(`${origin}/app#agreement/${agreement.id}/versions`)
      const submitted = commandResponse('agreement.submit')
      await page.getByRole('button', { name: 'Submit for review', exact: true }).click()
      expect((await (await submitted).json()).ok).toBe(true)
      await page.goto(`${origin}/app#agreement/${agreement.id}/review`)
      const approval = page.getByRole('region', { name: 'Email approval link', exact: true })
      const emailed = commandResponse('approval.email')
      await approval.getByRole('button', { name: 'Email approval link', exact: true }).click()
      const reply = await (await emailed).json()
      expect(reply.ok).toBe(true)
      expect(reply.mailReceipt.code).toBe('daily_digest')
      await expect(page.getByRole('status')).toContainText('daily digest')
      await fits()
      await screenshot('approval-digest')
      await page.getByRole('navigation', { name: 'Agreement sections', exact: true }).getByRole('link', { name: 'Approvals', exact: true }).click()
      const reminder = page.getByRole('region', { name: 'Approval reminders', exact: true })
      await expect(reminder).toBeVisible()
      const reminded = commandResponse('approval.remind')
      await reminder.getByRole('button', { name: 'Remind approver', exact: true }).click()
      const reminderReply = await (await reminded).json()
      expect(reminderReply.ok).toBe(true)
      expect(reminderReply.mailReceipt.code).toBe('daily_digest')
      await expect(page.getByRole('status')).toContainText('daily digest')
      await fits()
      await screenshot('reminder-digest')
    } finally { await close() }
  }
})

test('Chat status consent, member mapping, receipts and navigation tooltips at 1440 and 390 pixels',async({page})=>{
 for(const width of [1440,390]){
  const posts:any[]=[],replies:any[]=[]
  const product=await productPage(page,{width,bindings:{APPROVAL_SLACK_TOKEN:'synthetic-locket-1',CHAT_SLACK_SIGNING_SECRET:'synthetic-locket-signing'},outboundResponse:async(request:Request)=>{
   if(new URL(request.url).hostname==='hooks.slack.com'){replies.push(await request.json());return new Response('ok')}
   if(request.url.includes('auth.test'))return Response.json({ok:true,user_id:'synthetic-locket-bot',bot_id:'synthetic-locket-service'})
   if(request.method==='GET')return Response.json({ok:true,members:['synthetic-locket-person','synthetic-locket-bot']})
   posts.push(await request.json());return Response.json({ok:true,ts:'synthetic-locket-receipt'})
  }})
  try{
   const {owner,origin}=product,initial=await owner.state()
   const capture=async(name:string)=>{expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBe(true);if(process.env.LOCKET_SCREENSHOTS){await mkdir(process.env.LOCKET_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.LOCKET_SCREENSHOTS,`${width}-chat-${name}.png`),fullPage:true})}}
   const submit=async(region:any,name:string)=>{
    const response=page.waitForResponse(r=>r.url()===origin+'/api/locket/commands'&&r.request().method()==='POST')
    await region.getByRole('button',{name,exact:true}).click();const result=await(await response).json();expect(result.ok,JSON.stringify(result.error)).toBe(true)
   }
   await page.goto(origin+'/app#activity')
   const mapping=page.getByRole('region',{name:'Chat member mapping',exact:true})
   await mapping.getByLabel('Provider member identity',{exact:true}).fill('synthetic-locket-person')
   await mapping.getByLabel('Locket member',{exact:true}).selectOption(initial.actor.id)
   await submit(mapping,'Map chat member')
   await expect(mapping).toContainText('synthetic-locket-person')
   const binding=page.getByRole('region',{name:'Approval channel configuration',exact:true})
   await binding.getByLabel('Approval chat provider').selectOption('slack')
   await binding.getByLabel('Provider conversation identity').fill('synthetic-locket-dm')
   await submit(binding,'Bind approval conversation')
   await capture('mapping')
   await slackLaunch(product.h,'synthetic-locket-person',{shortcut:true})
   const token=launchToken(replies[0])
   await page.goto(origin+'/app#new/slack/'+token)
   await expect(page.getByRole('status')).toContainText('Opened from Slack')
   await page.getByLabel('Agreement title *',{exact:true}).fill('Slack shortcut request')
   await page.getByLabel('Request type *',{exact:true}).selectOption('nda')
   await page.getByLabel('Name',{exact:true}).fill('Shortcut counterparty')
   await page.getByRole('radio',{name:'Attach draft',exact:true}).check()
   await page.getByLabel('Draft (PDF or DOCX)',{exact:true}).setInputFiles({name:'draft.pdf',mimeType:'application/pdf',buffer:pdf('Confidentiality')})
   await page.getByLabel('Text (optional for PDF)',{exact:true}).fill('Confidentiality')
   await capture('shortcut-form')
   await submit(page,'Create request')
   await expect(page).toHaveURL(/#agreement\//)
   const submitted=await owner.state()
   expect(submitted.agreements.find((a:any)=>a.title==='Slack shortcut request').requester_id).toBe(initial.actor.id)

   const nav=page.getByRole('navigation',{name:'Locket',exact:true}).getByRole('link',{name:'Notifications',exact:true})
   await nav.focus();await expect(page.getByRole('tooltip')).toHaveText('Notifications')
   await capture('focus-tooltip')
   await nav.blur();await page.mouse.move(0,0);await nav.hover();await expect(page.getByRole('tooltip')).toHaveText('Notifications')
   await nav.click()
   const preferences=page.getByRole('region',{name:'Chat status notifications',exact:true})
   await preferences.getByLabel('Slack status updates').check();await submit(preferences,'Save chat updates')
   await page.reload();await expect(preferences.getByLabel('Slack status updates')).toBeChecked()
   const created=await owner.command('request.create',{title:'Confidential chat screen',type:'nda',restricted:true,party:{name:'Private counterparty',kind:'customer'},file:file('draft.pdf',pdf('Confidential terms')),text:'Confidential terms'})
   expect(posts.length).toBe(1);expect(posts[0].text).toContain(created.id);expect(posts[0].text).not.toContain('Confidential chat screen')
   await page.reload();await expect(preferences.getByLabel('Chat update receipts')).toContainText('Provider accepted; delivery unconfirmed')
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBe(true)
   await capture('accepted')
   await preferences.getByLabel('Slack status updates').uncheck();await submit(preferences,'Save chat updates')
   await page.reload();await expect(preferences.getByLabel('Slack status updates')).not.toBeChecked()
   const notification=page.getByRole('region',{name:'Notification preferences',exact:true})
   await notification.getByLabel('Daily email digest',{exact:true}).check();await submit(notification,'Save notification preferences')
   await preferences.getByLabel('Slack status updates').check();await submit(preferences,'Save chat updates')
   await owner.command('comment.add',{agreementId:created.id,versionId:created.versionId,body:'Private comment',mentionIds:[initial.actor.id]})
   await page.reload();await expect(preferences.getByLabel('Chat update receipts')).toContainText('Chat digest unavailable')
   expect(posts.length).toBe(1)
   await capture('withheld')
  }finally{await product.close()}
 }
})
