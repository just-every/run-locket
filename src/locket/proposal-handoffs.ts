import { readablePages } from './execution-comparison'
import { requireRole } from './access'
import type { Bindings } from '../auth.server'
import { agreementHandlers } from './agreements'
import { encodeBase64, readArtifactBytes, PDF } from './artifacts'
import { commit, type Ctx, type Handler } from './commands'
import { canonical, fail, integer, json, money, object, oneOf, list, sha256, sql, text } from './model'
import { agreementGuards, currentVersion, visibleAgreement } from './records'
import { textPdf } from './pdf'

function connection(env: Bindings, name: 'PLATTER'|'NECTAR') {
  const values = env as unknown as Record<string,unknown>, origin = values[name + '_ORIGIN'], token = values[name + '_TOKEN']
  if (typeof origin !== 'string' || typeof token !== 'string' || !token) fail('HANDOFF_CONFIG', `Configure the ${name} installation origin and token in private installation bindings.`, 503)
  let url: URL
  try { url = new URL(origin) } catch { fail('HANDOFF_CONFIG', 'Use an HTTPS installation origin.') }
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || url.port) fail('HANDOFF_CONFIG', 'Use an HTTPS installation origin with no path or credentials.')
  return { origin, token }
}
const importProposal: Handler = async (c, p) => {
  requireRole(c.actor, ['owner'], 'import an accepted proposal')
  if (p.consent !== true) fail('CONSENT', 'Confirm importing this accepted proposal into a native request.')
  const { origin, token } = connection(c.env, 'PLATTER'), id = text(p, 'proposalId', 100)
  const response = await fetch(origin + '/api/platter/agent/context', { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { authorization: `Bearer ${token}` } })
  if (!response.ok) fail('PLATTER_READ', `Platter context returned HTTP ${response.status}.`, 502)
  const context = await response.json() as any
  const proposal = context.proposals?.find((r:any) => r.id === id)
  if (!proposal || proposal.status !== 'accepted' || !proposal.acceptance || proposal.acceptance.revision !== proposal.revision) fail('NOT_ACCEPTED', 'Platter must show this exact proposal revision accepted.', 409)
  const revision = integer(proposal, 'revision', 1), acceptance = proposal.acceptance
  if (acceptance.currency !== 'USD' || proposal.currency !== 'USD') fail('PROPOSAL_PRICING', 'This handoff currently supports exact USD proposals only.', 409)
  const option = proposal.options?.find((r:any) => r.id === acceptance.optionId)
  if (!option || option.discount || acceptance.selection?.discountCents || option.optionalItems?.length) fail('PROPOSAL_PRICING', 'Optional items and discounted proposals need a reviewed pricing mapping before import.', 409)
  const lines = (option.tables ?? []).flatMap((table:any) => table.lines ?? [])
  if (!lines.length || lines.length > 100) fail('PROPOSAL_PRICING', 'Import requires one to one hundred quoted line items.', 409)
  const lineItems = lines.map((line:any) => {
    const quantity = integer({ quantity: Number(line.quantity) }, 'quantity', 1, 1000000), unitCents = money({ price: line.unitPrice }, 'price')
    if (unitCents === null || !Number.isSafeInteger(quantity * unitCents) || quantity * unitCents !== line.lineTotalCents || line.grossCents !== undefined && line.grossCents !== line.lineTotalCents) fail('PROPOSAL_PRICING', 'Fractional or discounted quantities need a reviewed pricing mapping.', 409)
    return { description: text({ description: [line.name, line.description].filter(Boolean).join(' - ') }, 'description', 500), quantity, unitCents, totalCents: quantity * unitCents }
  })
  const totalCents = lineItems.reduce((sum:number, line:any) => sum + line.totalCents, 0)
  if (!Number.isSafeInteger(totalCents) || totalCents !== acceptance.totalCents || totalCents !== option.cents) fail('PROPOSAL_PRICING', 'The selected line totals must exactly match the accepted price.', 409)
  if (await c.db.prepare('SELECT 1 FROM lk_proposal_sources WHERE origin=? AND proposal_id=? AND revision=?').bind(origin,id,revision).first()) fail('DUPLICATE_PROPOSAL', 'This accepted revision already has a native request.', 409)
  const title = text(proposal,'title',200), terms = typeof proposal.terms === 'string' ? proposal.terms : '', scope = typeof proposal.scope === 'string' ? proposal.scope : ''
  const content = [title,`Customer: ${proposal.clientName}`,scope,...lineItems.map((line:any) => `${line.description}: ${line.quantity} x USD ${(line.unitCents/100).toFixed(2)} = USD ${(line.totalCents/100).toFixed(2)}`),`Total USD ${(totalCents/100).toFixed(2)}`,terms].join('\n')
  if(!p.templateVersionId&&[...content].some(character=>character.charCodeAt(0)>255))fail('PROPOSAL_TEMPLATE','Choose an approved Word template for proposal text outside the plain PDF character set.',409)
  const out = await agreementHandlers['request.create'](c, { title, type:'customer', party:{name:text(proposal,'clientName',200),kind:'customer'}, value:(totalCents/100).toFixed(2),
    ...(p.templateVersionId ? {templateVersionId:p.templateVersionId,fields:object(p.fields??{}),clauseChoices:object(p.clauseChoices??{}),lineItems:lineItems.map((line:any)=>({description:line.description,quantity:line.quantity,unitPrice:(line.unitCents/100).toFixed(2)}))} : {file:{filename:'accepted-proposal.pdf',mediaType:PDF,base64:encodeBase64(textPdf(title,content,'Accepted proposal; native request requires Locket approval and execution.'))},text:content}) })
  const result = out.result as {id:string;versionId:string}
  const snapshot = { proposalId:id,revision,title,scope,terms,acceptance,lineItems,totalCents,currency:'USD' }
  out.writes.push(sql('INSERT INTO lk_proposal_sources VALUES(?,?,?,?,?,?,?,?)',crypto.randomUUID(),result.id,origin,id,revision,json(snapshot),c.actor.id,c.now))
  out.audit.push({action:'proposal.import',agreementId:result.id,summary:`Imported accepted Platter revision ${revision}; no approval or signature was imported.`})
  return out
}

async function billingInputs(c:Ctx, agreementId:unknown) {
  const a = await visibleAgreement(c, agreementId), v = await currentVersion(c,a)
  if (a.status !== 'executed') fail('NOT_EXECUTED','Execute the customer agreement before preparing billing.',409)
  if (a.type !== 'customer') fail('BILLING_TYPE','Only customer agreements can propose subscriptions.',409)
  const execution=await c.db.prepare("SELECT e.signed_artifact_id FROM lk_executions e JOIN lk_packages p ON p.id=e.package_id WHERE e.agreement_id=? AND p.version_id=? AND e.status='reconciled' AND e.imported=0 ORDER BY e.recorded_at DESC LIMIT 1").bind(a.id,v.id).first<{signed_artifact_id:string}>()
  const pages=execution?await readablePages(await readArtifactBytes(c.db,execution.signed_artifact_id)):null
  if(!pages)fail('BILLING_SOURCE','A reconciled readable signed PDF is required for automatic billing preparation.',409)
  const sourceText=pages.join('\n').replace(/\s+/g,' ').trim()
  const source = await c.db.prepare('SELECT snapshot FROM lk_proposal_sources WHERE agreement_id=?').bind(a.id).first<{snapshot:string}>()
  if (!source) fail('BILLING_SOURCE','Import an accepted proposal with its exact line items first.',409)
  const pricing = JSON.parse(source.snapshot)
  if (a.value_cents !== pricing.totalCents) fail('BILLING_PRICING','The agreement value differs from the quoted pricing. Review the pricing mapping first.',409)
  const terms = (await c.db.prepare("SELECT id,key,value FROM lk_terms WHERE agreement_id=? AND status='confirmed' ORDER BY key,id").bind(a.id).all<any>()).results
  const values = Object.fromEntries(terms.map(t=>[t.key,t.value]))
  for (const key of ['effective_date','initial_term_months','renewal_type']) if (!values[key]) fail('BILLING_TERMS',`Confirm ${key.replaceAll('_',' ')} from the executed agreement before proposing billing.`,409)
  if (values.renewal_type === 'auto_renew' && !values.renewal_term_months) fail('BILLING_TERMS','Confirm the renewal term before proposing billing.',409)
  return {a,v,pricing,values,sourceText,digest:await sha256(canonical(terms))}
}
const prepareBilling:Handler = async(c,p) => {
  requireRole(c.actor,['owner'],'prepare a subscription proposal')
  if (p.consent !== true) fail('CONSENT','Confirm that the quoted pricing still matches the executed customer agreement. Billing remains pending activation in Nectar.')
  const {a,v,pricing,values,sourceText,digest} = await billingInputs(c,p.agreementId), id=crypto.randomUUID()
  const mapping=object(p.nectarMapping,'nectarMapping')
  const quote=(value:unknown,label:string)=>{const q=text({quote:value},'quote',10000).replace(/\s+/g,' ');if(!sourceText.includes(q))fail('BILLING_QUOTE',`${label} must quote the exact executed-version text.`,409);return q}
  const customerQuote=quote(mapping.customerQuote,'Customer mapping'),sourceQuote=quote(mapping.subscriptionQuote,'Subscription mapping')
  const party=await c.db.prepare('SELECT name FROM lk_parties WHERE id=?').bind(a.party_id).first<{name:string}>()
  if(!party||!customerQuote.includes(party.name))fail('BILLING_QUOTE','Quote the executed customer name when mapping the Nectar customer.',409)
  const customerId=text(mapping,'customerId',100),mappings=list(mapping,'lines',100)
  if(mappings.length!==pricing.lineItems.length)fail('BILLING_MAPPING','Map every quoted line exactly once.')
  const catalog=pricing.lineItems.map((line:any,index:number)=>{
    const input=object(mappings[index]),q=quote(input.quote,`Line ${index+1}`)
    if(!q.includes(line.description)||!q.includes((line.unitCents/100).toFixed(2)))fail('BILLING_QUOTE','Each mapped line must quote its exact description and USD unit price.',409)
    if(typeof input.taxable!=='boolean')fail('BILLING_MAPPING','Explicitly confirm tax treatment for every line; Locket does not infer it.')
    return {key:`line-${index}`,new_product:{code:`locket-${a.id}-${index}`,name:line.description.slice(0,120)},kind:line.quantity===1?'flat':'seat',unit_amount:(line.unitCents/100).toFixed(2),taxable:input.taxable,interval_unit:oneOf(input,'intervalUnit',['month','year'] as const),interval_count:integer(input,'intervalCount',1,120),billing_timing:oneOf(input,'billingTiming',['advance','arrears'] as const),quote:q}
  })
  let renewal:Record<string,unknown>|undefined
  if(values.renewal_type==='auto_renew'){
    if(!values.notice_days)fail('BILLING_TERMS','Confirm the renewal notice period before proposing billing.',409)
    if(values.initial_term_months!==values.renewal_term_months)fail('BILLING_MAPPING','Different initial and renewal term lengths need a supported Nectar mapping.',409)
    const uplift=text(mapping,'renewalUpliftPercent',24)
    if(!/^(?:0|[1-9]\d?)(?:\.\d{1,6})?$|^100(?:\.0{1,6})?$/.test(uplift))fail('BILLING_MAPPING','Explicitly confirm a renewal uplift from zero through one hundred percent.')
    renewal={months:Number(values.renewal_term_months),auto_renew:true,notice_days:Number(values.notice_days),uplift_percent:uplift,quote:quote(mapping.renewalQuote,'Renewal mapping')}
  }else if(values.renewal_type!=='fixed')fail('BILLING_MAPPING','Evergreen and optional renewal require a supported Nectar mapping.',409)
  const payload={kind:'amendment',title:a.title,payload:{setup:true,source:{name:`${a.reference}-executed.txt`,text:sourceText,execution_reference:`${a.reference} version ${v.number} digest ${v.digest}`},customer:{id:customerId,quote:customerQuote},catalog,subscription:{external_id:a.id,start_date:values.effective_date,term_months:Number(values.initial_term_months),...(renewal?{renewal}:{}),quote:sourceQuote},items:pricing.lineItems.map((line:any,index:number)=>({key:`line-${index}`,price:`line-${index}`,quantity:line.quantity,quote:catalog[index].quote}))},evidence:{agreement:a.id,version:v.id,digest:v.digest,termsDigest:digest}}

  return {allowed:['owner'],result:{id,status:'prepared',proposal:payload},checks:agreementGuards(c,a,p),writes:[sql("INSERT INTO lk_billing_proposals VALUES(?,?,?,?,?,'prepared',NULL,NULL,?,?)",id,a.id,v.id,json(payload),digest,c.actor.id,c.now)],audit:[{action:'billing.proposal.prepare',agreementId:a.id,summary:'Owner confirmed the executed pricing and prepared a pending subscription proposal. No subscription was activated.'}]}
}
const sendBilling:Handler=async(c,p)=>{
  requireRole(c.actor,['owner'],'authorize a pending billing proposal handoff')
  if(p.consent!==true)fail('CONSENT','Approve sending this exact pending proposal to the configured Nectar installation.')
  connection(c.env,'NECTAR')
  const {a,v,digest}=await billingInputs(c,p.agreementId),id=text(p,'id',100)
  const row=await c.db.prepare("SELECT * FROM lk_billing_proposals WHERE id=? AND agreement_id=? AND status='prepared'").bind(id,a.id).first<any>()
  if(!row||row.version_id!==v.id||row.terms_digest!==digest)fail('STALE','Prepare the proposal again after reviewing the current executed terms.',409)
  return {allowed:['owner'],result:{id},checks:[...agreementGuards(c,a,p),sql("(SELECT status FROM lk_billing_proposals WHERE id=?)='prepared'",id)],writes:[sql("UPDATE lk_billing_proposals SET status='queued' WHERE id=?",id)],audit:[{action:'billing.proposal.authorize',agreementId:a.id,summary:'Owner approved the exact pending-only billing handoff.'}]}
}
export async function dispatchBillingProposal(c:Ctx,id:string){
  const row=await c.db.prepare('SELECT * FROM lk_billing_proposals WHERE id=?').bind(id).first<any>()
  if(!row||row.status!=='queued')return
  const {a,v,digest}=await billingInputs(c,row.agreement_id)
  if(row.version_id!==v.id||row.terms_digest!==digest)fail('STALE','Executed terms changed before dispatch.',409)
  const target=connection(c.env,'NECTAR')
  await commit(c,['owner'],[...agreementGuards(c,a),sql("(SELECT status FROM lk_billing_proposals WHERE id=?)='queued'",id)],[sql("UPDATE lk_billing_proposals SET status='sending' WHERE id=?",id)])
  let status='uncertain',receipt:string|null=null,error:string|null='provider_outcome_unknown'
  try{
    const response=await fetch(target.origin+'/api/nectar/proposal.create',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15_000),headers:{authorization:`Bearer ${target.token}`,'content-type':'application/json','idempotency-key':id},body:row.payload})
    if(response.ok){
      const body=await response.json() as any
      if(typeof body.id==='string'){
        const check=await fetch(target.origin+'/api/nectar/proposals/'+encodeURIComponent(body.id),{redirect:'manual',signal:AbortSignal.timeout(15_000),headers:{authorization:`Bearer ${target.token}`}})
        const detail=check.ok?await check.json() as any:null
        if(detail?.id===body.id&&detail.status==='pending'){status='pending';receipt=body.id;error=null}else error='pending_receipt_required'
      }else error='pending_receipt_required'
    }
    else {status=response.status>=400&&response.status<500?'rejected':'uncertain';error=`provider_http_${response.status}`}
  }catch{}
  await c.db.batch([c.db.prepare("UPDATE lk_billing_proposals SET status=?,receipt_id=?,last_error=? WHERE id=? AND status='sending'").bind(status,receipt,error,id),c.db.prepare('INSERT INTO lk_audit VALUES(?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),Date.now(),c.actor.id,c.actor.name,c.actor.role,'billing.proposal.outcome',a.id,`Pending-only billing handoff: ${status}`,c.commandId)])
}
export const proposalHandoffHandlers={'proposal.import':importProposal,'billing.proposal.prepare':prepareBilling,'billing.proposal.send':sendBilling}
