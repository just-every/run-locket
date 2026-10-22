import { uptimeDenominatorPolicy } from '../locket/service-level-evidence'
import { Field, Form, value } from './controls'
import { can, parse } from './format'
import type { ServiceLevelProps } from './service-levels'

export function ServiceLevelSettings({state,a,locket}:ServiceLevelProps) {
 const link=state.serviceLevels.links.find(l=>l.agreement_id===a.id),term=state.serviceLevels.terms.find(t=>t.agreement_id===a.id)
 const family=new Set([a.id])
 for(let size=-1;size!==family.size;){size=family.size;for(const source of state.agreements)if(source.relation==='amends'&&family.has(source.parent_id))family.add(source.id)}
 const signed=state.agreements.filter(s=>['executed','imported'].includes(s.status)&&family.has(s.id))
 return <>
  {can(state,'owner')&&<details><summary>Authorize Uptime monitoring</summary><Form busy={locket.busy} submit="Authorize exact Uptime monitor" onSubmit={data=>void locket.run('service-level.link',{agreementId:a.id,version:a.version,origin:value(data,'origin'),monitorId:value(data,'monitorId'),consent:data.get('consent')==='on'})}>
   <Field label="Uptime installation origin" hint="The exact public HTTPS origin configured for the server's Uptime connection."><input name="origin" type="url" required defaultValue={link?.origin??''} placeholder="https://monitoring.example.com"/></Field>
   <Field label="Uptime monitor ID"><input name="monitorId" required defaultValue={link?.monitor_id??''}/></Field>
   <label className="lk-check"><input name="consent" type="checkbox" required/> I authorize reading this exact installation and monitor for this agreement.</label>
  </Form></details>}
  {link&&can(state,'counsel')&&<details><summary>Confirm signed service-level formula</summary><Form busy={locket.busy} submit="Confirm signed service-level terms" onSubmit={data=>void locket.run('service-level.confirm',{
   agreementId:a.id,version:a.version,sourceAgreementId:value(data,'sourceAgreementId'),citation:{quote:value(data,'quote'),...(value(data,'page')?{page:Number(value(data,'page'))}:{})},
   targetBps:Math.round(Number(value(data,'target'))*100),tierFloorBps:Math.round(Number(value(data,'tierFloor'))*100),creditBps:Math.round(Number(value(data,'credit'))*100),monthlyBasis:value(data,'monthlyBasis'),timeZone:value(data,'timeZone'),claimDays:Number(value(data,'claimDays')),
   denominatorPolicy:uptimeDenominatorPolicy,interpretation:value(data,'interpretation'),confirmExclusions:data.get('exclusions')==='on',confirmFormula:data.get('formula')==='on',
  })}>
   <Field label="Service-level signed source"><select name="sourceAgreementId" defaultValue={term?.source_agreement_id??a.id}>{signed.map(s=><option key={s.id} value={s.id}>{s.reference}: {s.title}</option>)}</select></Field>
   <Field label="Exact signed service-level clause"><textarea name="quote" required rows={4} defaultValue={term?parse<any>(term.citation).quote:''}/></Field>
   <Field label="Service-level clause page"><input name="page" type="number" min="1" defaultValue={term?parse<any>(term.citation).page:undefined}/></Field>
   <Field label="Monthly uptime commitment (%)"><input name="target" type="number" min="0.01" max="100" step="0.01" required defaultValue={term?term.target_bps/100:undefined}/></Field>
   <Field label="Credit tier lower bound (%)" hint="The confirmed tier includes this lower bound and excludes the commitment above it."><input name="tierFloor" type="number" min="0" max="99.99" step="0.01" required defaultValue={term?term.tier_floor_bps/100:undefined}/></Field>
   <Field label="Service credit (%)"><input name="credit" type="number" min="0.01" max="100" step="0.01" required defaultValue={term?term.credit_bps/100:undefined}/></Field>
   <Field label="Monthly service charge (USD)"><input name="monthlyBasis" type="number" min="0.01" step="0.01" required defaultValue={term?(term.monthly_cents/100).toFixed(2):undefined}/></Field>
   <Field label="Service month time zone"><input name="timeZone" required defaultValue={term?.timezone??a.timezone}/></Field>
   <Field label="Claim window after month end (days)"><input name="claimDays" type="number" min="1" max="365" required defaultValue={term?.claim_days}/></Field>
   <Field label="Counsel service-level interpretation"><textarea name="interpretation" required rows={3} defaultValue={term?.interpretation??''}/></Field>
   <p>{uptimeDenominatorPolicy}</p>
   <label className="lk-check"><input name="exclusions" type="checkbox" required/> I confirm that excluding unknown, paused and maintenance time matches the signed commitment.</label>
   <label className="lk-check"><input name="formula" type="checkbox" required/> I confirm this monthly charge, credit tier, time zone and claim window against the signed clause and amendments.</label>
  </Form></details>}
 </>
}
