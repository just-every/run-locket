import {file,pdf} from './files.mjs'
import {randomUUID} from 'node:crypto'
const at=iso=>Date.parse(iso)
export const coiClause = 'The supplier must maintain USD 2000000 insurance naming Harbor Couriers from 2026-08-01 through 2027-08-01.'
export const certificate = (amount,{insured='Harbor Couriers',validFrom='2026-08-01',validThrough='2027-08-01'}={}) => pdf(`Coverage: USD ${amount}; Named insured: ${insured}; Effective: ${validFrom}; Expires: ${validThrough}`)
export async function remediationFixture(h) {
 if(h.setTime)await h.setTime(at('2026-08-03T15:00:00Z'))
 const owner=(await h.owner.state()).actor.id,reference=randomUUID()
 const a=await h.owner.command('legacy.import',{title:'Insured courier',type:'supplier',party:{name:'Harbor Couriers',kind:'supplier',contacts:[{name:'Broker',email:'broker@example.test'}]},sourceSystem:'Shared drive',sourceId:'synthetic-locket-coi-'+reference,signed:true,text:coiClause,file:file('agreement.pdf',pdf(coiClause+' Contract reference '+reference))})
 const o=await h.owner.command('obligation.add',{agreementId:a.id,description:'Replace expired certificate of insurance',ownerId:owner,dueDate:'2026-08-01',recurrence:'none',evidence:'file',citation:{quote:coiClause}})
 await h.owner.command('obligation.update',{agreementId:a.id,obligationId:o.id,action:'confirm'})
 const requirement=await h.owner.command('remediation.configure',{obligationId:o.id,kind:'coi',requirement:{coverageCents:200000000,insured:'Harbor Couriers',validFrom:'2026-08-01',validThrough:'2027-08-01'},citation:{quote:coiClause}})
 return {a,o,requirement}
}
