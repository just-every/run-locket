import type { SignatureConnection } from './signature-provider'
import { executionArchive } from './execution-archive'

export const retrievalProviders = ['docusign', 'adobe-acrobat-sign', 'dropbox-sign'] as const
type Read = (path: string, binary?: boolean) => Promise<any>

/** Read provider evidence only. No callback or inferred signer creates evidence. */
export async function completedPackage(connection: SignatureConnection, envelopeId: string, read: Read, files?: {signedName:string;certificateName:string}) {
  const id = encodeURIComponent(envelopeId)
  if (connection.provider === 'docusign') {
    const path = `/accounts/${encodeURIComponent(connection.account_id!)}/envelopes/${id}`
    const envelope = await read(path)
    if (envelope.envelopeId !== envelopeId) throw Error('provider_envelope_mismatch')
    if (envelope.status !== 'completed') return null
    const recipients = await read(path + '/recipients')
    if (!Array.isArray(recipients.signers) || !recipients.signers.length || recipients.signers.some((r: any) => r.status !== 'completed')) throw Error('provider_completion_incomplete')
    const completed = new Date(envelope.completedDateTime)
    if (!Number.isFinite(completed.getTime())) throw Error('provider_completion_incomplete')
    return { completed, signers: recipients.signers.map((r: any) => ({name:r.name,email:r.email,signedAt:r.signedDateTime})),
      signed: await read(path + '/documents/combined', true), certificate: await read(path + '/documents/certificate', true) }
  }
  if (connection.provider === 'dropbox-sign') {
    const result=await read(`/signature_request/${id}`), request=result.signature_request
    if (request?.signature_request_id!==envelopeId) throw Error('provider_envelope_mismatch')
    if (request.is_complete!==true) return null
    if (request.is_declined || request.has_error || !Array.isArray(request.signatures) || !request.signatures.length || request.signatures.some((s:any)=>s.status_code!=='signed' || !s.signer_name || !s.signer_email_address || !Number.isSafeInteger(s.signed_at) || s.signed_at<=0 || !Number.isFinite(new Date(s.signed_at*1000).getTime()))) throw Error('provider_completion_incomplete')
    if (!files) throw Error('provider_archive_mapping_missing')
    const archive=await read(`/signature_request/files/${id}?file_type=zip`,true)
    return {...executionArchive(archive,files.signedName,files.certificateName),
      completed:new Date(Math.max(...request.signatures.map((s:any)=>s.signed_at))*1000),
      signers:request.signatures.map((s:any)=>({name:s.signer_name,email:s.signer_email_address,signedAt:new Date(s.signed_at*1000).toISOString()}))}
  }
  if (connection.provider !== 'adobe-acrobat-sign') throw Error('provider_retrieval_unsupported')
  const path = `/agreements/${id}`, agreement = await read(path)
  if (agreement.id !== envelopeId) throw Error('provider_envelope_mismatch')
  if (agreement.status !== 'SIGNED') return null
  const members = await read(path + '/members'), events = await read(path + '/events')
  const sets = members.participantSets?.filter((s: any) => s.role === 'SIGNER')
  // Recipient groups need actual signer evidence; never choose one member by guess.
  if (!Array.isArray(sets) || !sets.length || sets.some((s: any) => s.status !== 'COMPLETED' || !Array.isArray(s.memberInfos) || !s.memberInfos.length)) throw Error('provider_completion_incomplete')
  const signers = sets.map((s: any) => {
    const candidates = s.memberInfos.filter((member: any) => Array.isArray(events.events) && events.events.some((e: any) => e.type === 'ESIGNED' && typeof e.participantEmail === 'string' && e.participantEmail.toLowerCase() === member.email?.toLowerCase()))
    if (candidates.length !== 1) throw Error('provider_completion_incomplete')
    const member = candidates[0]
    const signed = Array.isArray(events.events) ? events.events.filter((e: any) => e.type === 'ESIGNED' && typeof e.participantEmail === 'string' && e.participantEmail.toLowerCase() === member.email?.toLowerCase()) : []
    const dates = signed.map((e: any) => Date.parse(e.date))
    if (!member.name || !member.email || !dates.length || dates.some((d: number) => !Number.isFinite(d))) throw Error('provider_completion_incomplete')
    return {name:member.name,email:member.email,signedAt:new Date(Math.max(...dates)).toISOString()}
  })
  return { completed: new Date(Math.max(...signers.map((s: any) => Date.parse(s.signedAt)))), signers,
    signed: await read(path + '/combinedDocument?attachAuditReport=false', true), certificate: await read(path + '/auditTrail', true) }
}
