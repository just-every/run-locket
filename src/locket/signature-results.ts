import { may,requireRole } from './access'
import type { Ctx } from './commands'
import { fail } from './model'
import { visibleAgreement } from './records'
import { requireCoordinator } from './signature-rules'

/** Durable command acknowledgements retain today's read and coordinator fences. */
export async function authorizeSignatureResult(c:Ctx,type:string,p:Record<string,unknown>){
 if(type.startsWith('package.')){
  const a=await visibleAgreement(c,p.agreementId)
  await requireCoordinator(c,a)
  if(type==='package.send')requireRole(c.actor,['owner'],'read a provider operation acknowledgement')
 }else if(type==='signature.availability'){
  requireRole(c.actor,may.signature,'read signer availability outcomes')
  if(p.operatorId&&p.operatorId!==c.actor.id&&c.actor.role!=='owner')fail('FORBIDDEN','Only the owner reads another signer’s availability outcome.',403)
 }else if(type.startsWith('signature.'))requireRole(c.actor,['owner'],'read signing configuration outcomes')
}
