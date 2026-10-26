// Stripe receives only a draft quote. A billing person must review and activate it.
import type { Ctx } from './commands'
import { fail, json, text } from './model'

export function stripeToken(c:Ctx) {
  if(!c.env.STRIPE_SECRET_KEY)fail('HANDOFF_CONFIG','Configure the server-only Stripe credential.',503)
  return c.env.STRIPE_SECRET_KEY!
}
export async function stripeDraft(c:Ctx,mapping:Record<string,unknown>,proposal:any) {
  const token=stripeToken(c),setup=proposal.payload,form=new URLSearchParams()
  if(setup.catalog.some((line:any)=>line.billing_timing!=='advance'||line.taxable))fail('BILLING_MAPPING','Stripe draft quotes currently require explicit advance billing and no tax. No billing decision is inferred.',409)
  if(setup.subscription.renewal?.uplift_percent&&Number(setup.subscription.renewal.uplift_percent)!==0)fail('BILLING_MAPPING','A nonzero renewal uplift needs a supported Stripe price schedule.',409)
  const effective=Math.floor(Date.parse(setup.subscription.start_date+'T00:00:00Z')/1000)
  if(!Number.isSafeInteger(effective)||effective<=Math.floor(c.now/1000))fail('BILLING_MAPPING','Stripe quotes require a future confirmed effective date.',409)
  const mappings=mapping.lines as any[]
  for(let i=0;i<setup.catalog.length;i++) {
    const id=text(mappings[i],'stripePriceId',100),line=setup.catalog[i]
    const response=await fetch('https://api.stripe.com/v1/prices/'+encodeURIComponent(id),{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${token}`}})
    const price:any=response.ok?await response.json():null
    if(!price||price.id!==id||price.active!==true||price.currency!=='usd'||price.unit_amount!==Math.round(Number(line.unit_amount)*100)||price.recurring?.interval!==line.interval_unit||price.recurring?.interval_count!==line.interval_count||price.billing_scheme!=='per_unit'||price.transform_quantity||price.custom_unit_amount||price.recurring?.usage_type!=='licensed')fail('BILLING_MAPPING','The selected Stripe price must exactly match the confirmed USD price, interval and licensed quantity without transforms.',409)
    form.set(`line_items[${i}][price]`,id)
    form.set(`line_items[${i}][quantity]`,String(setup.items[i].quantity))
  }
  form.set('customer',setup.customer.id)
  form.set('automatic_tax[enabled]','false')
  form.set('subscription_data[effective_date]',String(effective))
  form.set('description',`Locket proposed subscription. Start ${setup.subscription.start_date}; initial term ${setup.subscription.term_months} months; ${setup.subscription.renewal?`renewal ${setup.subscription.renewal.months} months, notice ${setup.subscription.renewal.notice_days} days, uplift ${setup.subscription.renewal.uplift_percent}%`:'fixed term'}. Billing person must implement these terms before activation.`)
  const metadata={locket_agreement:proposal.evidence.agreement,locket_version:proposal.evidence.version,locket_digest:proposal.evidence.digest,locket_terms:proposal.evidence.termsDigest,locket_initial_months:String(setup.subscription.term_months),locket_renewal:setup.subscription.renewal?json({months:setup.subscription.renewal.months,noticeDays:setup.subscription.renewal.notice_days,upliftPercent:setup.subscription.renewal.uplift_percent}):'fixed'}
  for(const [key,value] of Object.entries(metadata))form.set(`metadata[${key}]`,value)
  return {provider:'stripe',form:form.toString(),evidence:proposal.evidence}
}
export async function sendStripeDraft(c:Ctx,id:string,payload:any) {
  const token=stripeToken(c),form=new URLSearchParams(payload.form)
  const response=await fetch('https://api.stripe.com/v1/quotes',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${token}`,'content-type':'application/x-www-form-urlencoded','idempotency-key':id},body:payload.form})
  if(!response.ok)return {status:response.status>=400&&response.status<500?'rejected':'uncertain',receipt:null,error:`provider_http_${response.status}`}
  const created:any=await response.json()
  if(typeof created.id!=='string')return {status:'uncertain',receipt:null,error:'pending_receipt_required'}
  const check=await fetch('https://api.stripe.com/v1/quotes/'+encodeURIComponent(created.id),{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${token}`}})
  const detail:any=check.ok?await check.json():null
  const metadata=[...form].filter(([key])=>key.startsWith('metadata['))
  if(detail?.id!==created.id||detail.status!=='draft'||detail.subscription!==null||detail.subscription_schedule!==null||detail.customer!==form.get('customer')||detail.subscription_data?.effective_date!==Number(form.get('subscription_data[effective_date]'))||metadata.some(([key,value])=>detail.metadata?.[key.slice(9,-1)]!==value))return {status:'uncertain',receipt:null,error:'pending_receipt_required'}
  const itemsResponse=await fetch('https://api.stripe.com/v1/quotes/'+encodeURIComponent(created.id)+'/line_items',{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${token}`}})
  const items:any=itemsResponse.ok?await itemsResponse.json():null
  const expected=[...form.keys()].filter(key=>/^line_items\[\d+\]\[price\]$/.test(key))
  if(!items||items.has_more!==false||!Array.isArray(items.data)||items.data.length!==expected.length||items.data.some((line:any,index:number)=>line.price?.id!==form.get(`line_items[${index}][price]`)||line.quantity!==Number(form.get(`line_items[${index}][quantity]`))||line.currency!=='usd'||line.amount_subtotal!==line.price.unit_amount*line.quantity||line.amount_total!==line.amount_subtotal||(line.discount_amounts??[]).some((amount:any)=>amount.amount!==0)||(line.tax_amounts??[]).some((amount:any)=>amount.amount!==0)))return {status:'uncertain',receipt:null,error:'pending_line_receipt_required'}
  return {status:'pending',receipt:created.id,error:null}
}
