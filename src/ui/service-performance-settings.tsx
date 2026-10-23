import { useState } from 'react'
import { Field, Form, value } from './controls'
import { can } from './format'
import { performanceMetric, type ServicePerformanceProps } from './service-performance'

export function ServicePerformanceSettings({state,agreement:a,locket}:ServicePerformanceProps) {
 const [metric,setMetric]=useState('response'),[tiers,setTiers]=useState([0]),[nextTier,setNextTier]=useState(1)
 if(!can(state,'counsel'))return null
 const family=new Set([a.id])
 for(let size=-1;size!==family.size;){size=family.size;for(const source of state.agreements)if(source.relation==='amends'&&family.has(source.parent_id))family.add(source.id)}
 const signed=state.agreements.filter(s=>family.has(s.id)&&['executed','imported'].includes(s.status))
 return <details><summary>Confirm signed performance formula</summary><Form busy={locket.busy} submit="Confirm signed performance terms" onSubmit={data=>void locket.run('service-performance.confirm',{
  agreementId:a.id,version:a.version,sourceAgreementId:value(data,'sourceAgreementId'),citation:{quote:value(data,'quote'),...(value(data,'page')?{page:Number(value(data,'page'))}:{})},metric,clock:'wall',aggregation:'worst_record_once',thresholdMinutes:metric==='delivery'?0:Number(value(data,'thresholdMinutes')),
  tiers:tiers.map(id=>({minimumLateMinutes:Number(value(data,`minimumLateMinutes-${id}`)),creditBps:Math.round(Number(value(data,`credit-${id}`))*100)})),eligibleFee:value(data,'eligibleFee'),allocation:value(data,'allocation'),cap:value(data,'cap'),timeZone:value(data,'timeZone'),claimDays:Number(value(data,'claimDays')),interpretation:value(data,'interpretation'),confirmFormula:data.get('confirmFormula')==='on',
 })}>
  <Field label="Performance signed source"><select name="sourceAgreementId" defaultValue={a.id}>{signed.map(s=><option key={s.id} value={s.id}>{s.reference}: {s.title}</option>)}</select></Field>
  <Field label="Exact signed performance clause"><textarea name="quote" rows={5} required/></Field>
  <Field label="Performance clause page"><input name="page" type="number" min="1"/></Field>
  <Field label="Performance metric"><select value={metric} onChange={e=>setMetric(e.target.value)}>{Object.entries(performanceMetric).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field>
  {metric!=='delivery'&&<Field label="Performance threshold (minutes)" hint="Elapsed wall-clock minutes from record creation to first public response or reported resolution."><input name="thresholdMinutes" type="number" min="1" step="1" required/></Field>}
  <p>{metric==='delivery'?'Delivery lateness is the wall-clock duration from the reported due timestamp to the reported delivery timestamp.':'This formula uses wall-clock elapsed time. Confirm that this matches the signed commitment; business hours are not inferred.'}</p>
  <fieldset className="lk-fieldset"><legend>Signed credit tiers</legend><p>Choose the tier whose minimum lateness is strictly exceeded by the worst proven late record. A minimum of zero covers any proven miss. Unknown events do not add a credit.</p>
   {tiers.map((id,index)=><div className="lk-card" key={id} aria-label={`Performance credit tier ${index+1}`}>
    <Field label={`Tier ${index+1} minimum lateness (minutes)`}><input name={`minimumLateMinutes-${id}`} type="number" min="0" step="1" required/></Field>
    <Field label={`Tier ${index+1} service credit (%)`}><input name={`credit-${id}`} type="number" min="0.01" max="100" step="0.01" required/></Field>
    {tiers.length>1&&<button type="button" onClick={()=>setTiers(tiers.filter(t=>t!==id))}>Remove tier {index+1}</button>}
   </div>)}
   <button type="button" onClick={()=>{setTiers([...tiers,nextTier]);setNextTier(nextTier+1)}}>Add performance credit tier</button>
  </fieldset>
  <Field label="Eligible monthly service fee (USD)"><input name="eligibleFee" type="number" min="0.01" step="0.01" required/></Field>
  <Field label="Eligible fee allocation" hint="Identify the services and fee portion covered by this commitment, including exclusions and adjustments."><textarea name="allocation" rows={3} required/></Field>
  <Field label="Monthly performance credit cap (USD)"><input name="cap" type="number" min="0.01" step="0.01" required/></Field>
  <p>One credit for this metric and month uses the worst proven lateness, with no sum or per-event stacking, and equals the selected tier percentage of the eligible fee, limited to the confirmed monthly cap.</p>
  <Field label="Performance service month time zone"><input name="timeZone" required defaultValue={a.timezone}/></Field>
  <Field label="Performance claim window after month end (days)"><input name="claimDays" type="number" min="1" max="365" step="1" required/></Field>
  <Field label="Counsel performance interpretation"><textarea name="interpretation" rows={4} required/></Field>
  <label className="lk-check"><input name="confirmFormula" type="checkbox" required/> I confirm the exact signed source, wall-clock metric, thresholds, eligible fee allocation, tiers, cap, service window and claim deadline. Reported closure alone does not prove fulfillment.</label>
 </Form></details>
}
